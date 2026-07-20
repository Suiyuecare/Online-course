import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ refundId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { refundId } = await params;
  const { data: refund } = await admin
    .from("refunds")
    .select("id,order_id,status,refund_scope")
    .eq("id", refundId)
    .maybeSingle();
  if (
    !refund ||
    refund.refund_scope !== "individual" ||
    !["manual_review", "approved"].includes(refund.status)
  )
    return NextResponse.json(
      { error: "REFUND_NOT_ACTIONABLE" },
      { status: 409 },
    );
  const { data: order } = await admin
    .from("orders")
    .select("id,buyer_id,merchant_trade_no,order_kind")
    .eq("id", refund.order_id)
    .maybeSingle();
  if (!order)
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (order.order_kind === "enterprise_seat_pack")
    return NextResponse.json(
      { error: "ENTERPRISE_REFUND_REQUIRES_ENTERPRISE_FLOW" },
      { status: 409 },
    );
  const { data: items } = await admin
    .from("order_items")
    .select("course_id,live_session_id")
    .eq("order_id", refund.order_id);
  const now = new Date().toISOString();
  await admin
    .from("refunds")
    .update({ status: "paid", decided_at: now })
    .eq("id", refund.id);
  await admin
    .from("orders")
    .update({ status: "refunded" })
    .eq("id", refund.order_id);
  for (const item of items ?? []) {
    if (!item.course_id) continue;
    const { data: sourceEntitlements } = await admin
      .from("entitlements")
      .select("live_session_id,active")
      .eq("source_order_id", refund.order_id)
      .eq("user_id", order.buyer_id)
      .eq("course_id", item.course_id)
      .is("organization_id", null);
    const effectiveLiveSessionId =
      sourceEntitlements?.find((entitlement) => entitlement.active)
        ?.live_session_id ??
      sourceEntitlements?.find((entitlement) => entitlement.live_session_id)
        ?.live_session_id ??
      item.live_session_id;
    let enrollmentQuery = admin
      .from("enrollments")
      .select("id")
      .eq("learner_id", order.buyer_id)
      .eq("course_id", item.course_id)
      .is("organization_id", null);
    enrollmentQuery = effectiveLiveSessionId
      ? enrollmentQuery.eq("live_session_id", effectiveLiveSessionId)
      : enrollmentQuery.is("live_session_id", null);
    const { data: affectedEnrollments } = await enrollmentQuery;

    let otherEntitlementQuery = admin
      .from("entitlements")
      .select("id")
      .eq("user_id", order.buyer_id)
      .eq("course_id", item.course_id)
      .eq("active", true)
      .is("organization_id", null)
      .neq("source_order_id", refund.order_id)
      .limit(1);
    otherEntitlementQuery = effectiveLiveSessionId
      ? otherEntitlementQuery.eq("live_session_id", effectiveLiveSessionId)
      : otherEntitlementQuery.is("live_session_id", null);
    const { data: otherEntitlement } =
      await otherEntitlementQuery.maybeSingle();
    await admin
      .from("entitlements")
      .update({ active: false, ends_at: now })
      .eq("source_order_id", refund.order_id)
      .eq("course_id", item.course_id);
    if (effectiveLiveSessionId)
      await admin
        .from("live_session_bookings")
        .update({ status: "refunded" })
        .eq("source_order_id", refund.order_id)
        .eq("learner_id", order.buyer_id)
        .in("status", ["held", "confirmed"]);
    const enrollmentIds = (affectedEnrollments ?? []).map(
      (enrollment) => enrollment.id,
    );
    if (enrollmentIds.length && !otherEntitlement) {
      await admin
        .from("enrollments")
        .update({ status: "refunded" })
        .in("id", enrollmentIds)
        .is("organization_id", null);
      await admin
        .from("certificates")
        .update({ revoked_at: now, revocation_reason: "課程訂單已退款" })
        .in("enrollment_id", enrollmentIds)
        .is("revoked_at", null);
    }
  }
  await admin
    .from("payment_events")
    .insert({
      provider_event_key: `manual-refund:${refund.id}`,
      merchant_trade_no: order.merchant_trade_no,
      event_type: "refund_recorded",
      verified: true,
      payload: { refund_id: refund.id },
    });
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: "refund.marked_paid",
      target_type: "refund",
      target_id: refund.id,
      after_data: { entitlement_revoked: true, certificates_revoked: true },
    });
  return NextResponse.json({ ok: true });
}
