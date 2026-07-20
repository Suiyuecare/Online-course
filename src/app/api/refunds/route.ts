import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_REFUND_REQUEST" },
      { status: 400 },
    );
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: order } = await admin
    .from("orders")
    .select("id,amount_twd,status,order_kind")
    .eq("id", parsed.data.orderId)
    .eq("buyer_id", userId)
    .maybeSingle();
  if (
    !order ||
    order.order_kind === "enterprise_seat_pack" ||
    order.status !== "paid"
  )
    return NextResponse.json(
      { error: "ORDER_NOT_REFUNDABLE" },
      { status: 409 },
    );
  const { data: existing } = await admin
    .from("refunds")
    .select("id,status")
    .eq("order_id", order.id)
    .in("status", ["manual_review", "approved", "paid"])
    .maybeSingle();
  if (existing) return NextResponse.json({ refund: existing });
  const { data: refund, error } = await admin
    .from("refunds")
    .insert({
      order_id: order.id,
      requested_by: userId,
      amount_twd: order.amount_twd,
      reason: parsed.data.reason,
      status: "manual_review",
      automatic: false,
    })
    .select("id,status")
    .single();
  if (error)
    return NextResponse.json(
      { error: "REFUND_CREATE_FAILED" },
      { status: 500 },
    );
  await admin
    .from("audit_events")
    .insert({
      actor_id: userId,
      action: "refund.requested",
      target_type: "order",
      target_id: order.id,
      after_data: { refund_id: refund.id },
    });
  return NextResponse.json({ refund });
}
