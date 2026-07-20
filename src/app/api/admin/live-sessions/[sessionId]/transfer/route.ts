import { NextResponse } from "next/server";
import { z } from "zod";
import { sendLiveCourseEmail } from "@/lib/live-email";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({
  bookingId: z.string().uuid(),
  targetSessionId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_TRANSFER" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  const { sessionId } = await params;
  if (!admin || !actorId)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: source } = await admin
    .from("live_session_bookings")
    .select("id,live_session_id,learner_id")
    .eq("id", parsed.data.bookingId)
    .eq("live_session_id", sessionId)
    .maybeSingle();
  if (!source)
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  const { data: enterpriseAllocation } = await admin
    .from("enterprise_seat_allocations")
    .select("id,organization_id")
    .eq("booking_id", source.id)
    .maybeSingle();
  const transferResult = enterpriseAllocation
    ? await admin.rpc("select_enterprise_live_session", {
        target_allocation_id: enterpriseAllocation.id,
        target_session_id: parsed.data.targetSessionId,
        target_actor_id: actorId,
      })
    : await admin.rpc("transfer_live_booking", {
        source_booking_id: source.id,
        target_session_id: parsed.data.targetSessionId,
      });
  const { data: transferred, error } = transferResult;
  if (error)
    return NextResponse.json(
      { error: "TRANSFER_FAILED", message: error.message },
      { status: 409 },
    );
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      organization_id: enterpriseAllocation?.organization_id ?? null,
      action: "live_booking.transferred",
      target_type: "live_booking",
      target_id: source.id,
      before_data: { live_session_id: sessionId },
      after_data: {
        target_live_session_id: parsed.data.targetSessionId,
        reason: parsed.data.reason,
      },
    });
  const transferredRow = Array.isArray(transferred) ? transferred[0] : transferred;
  const transferredBookingId = enterpriseAllocation
    ? transferredRow?.booking_id
    : transferredRow?.id;
  if (transferredBookingId)
    await sendLiveCourseEmail(
      transferredBookingId,
      "purchase_confirmation",
      request,
    ).catch(() => undefined);
  const booking = enterpriseAllocation
    ? (
        await admin
          .from("live_session_bookings")
          .select("*")
          .eq("id", transferredBookingId)
          .maybeSingle()
      ).data
    : transferred;
  return NextResponse.json({ booking });
}
