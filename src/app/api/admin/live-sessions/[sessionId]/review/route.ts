import { NextResponse } from "next/server";
import { z } from "zod";
import { maybeCompleteEnrollment } from "@/lib/completion";
import { recomputeLiveAttendance } from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({
  bookingId: z.string().uuid(),
  decision: z.enum(["maintain_disqualified", "manual_correction"]),
  reason: z.string().trim().min(5).max(1000),
  cameraSecondsDelta: z.number().int().min(-86400).max(86400).default(0),
  checkInOverride: z.boolean().optional(),
  checkOutOverride: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  const { sessionId } = await params;
  if (!admin || !actorId)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: booking } = await admin
    .from("live_session_bookings")
    .select("id,enrollment_id")
    .eq("id", parsed.data.bookingId)
    .eq("live_session_id", sessionId)
    .maybeSingle();
  if (!booking)
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  const { data: adjustment, error } = await admin
    .from("live_attendance_adjustments")
    .insert({
      booking_id: booking.id,
      actor_id: actorId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      camera_seconds_delta: parsed.data.cameraSecondsDelta,
      check_in_override: parsed.data.checkInOverride,
      check_out_override: parsed.data.checkOutOverride,
    })
    .select("id")
    .single();
  if (error)
    return NextResponse.json({ error: "REVIEW_WRITE_FAILED" }, { status: 500 });
  const summary = await recomputeLiveAttendance(admin, booking.id);
  const completion =
    booking.enrollment_id && summary.attendance_status === "qualified"
      ? await maybeCompleteEnrollment(admin, booking.enrollment_id)
      : null;
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: "live_attendance.reviewed",
      target_type: "live_booking",
      target_id: booking.id,
      after_data: { adjustment_id: adjustment.id, ...parsed.data, summary },
    });
  return NextResponse.json({ ok: true, summary, completion });
}
