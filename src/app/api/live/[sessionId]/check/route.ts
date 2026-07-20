import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeEnterpriseAllocation } from "@/lib/enterprise-learning";
import {
  getConfirmedLiveBooking,
  isWithinWindow,
  recomputeLiveAttendance,
} from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  action: z.enum(["check_in", "check_out", "exception_requested"]),
  equipment: z
    .object({
      camera: z.boolean(),
      microphone: z.boolean(),
      speaker: z.boolean(),
    })
    .optional(),
  reason: z.string().trim().min(5).max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (process.env.FEATURE_LIVE_COURSES !== "true")
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_ATTENDANCE_REQUEST" },
      { status: 400 },
    );
  const { sessionId } = await params;
  const booking = await getConfirmedLiveBooking(admin, userId, sessionId);
  const session =
    booking &&
    (Array.isArray(booking.live_sessions)
      ? booking.live_sessions[0]
      : booking.live_sessions);
  if (!booking || !session)
    return NextResponse.json(
      { error: "LIVE_BOOKING_REQUIRED" },
      { status: 403 },
    );
  if (session.status === "cancelled")
    return NextResponse.json(
      { error: "LIVE_SESSION_CANCELLED" },
      { status: 409 },
    );
  if (
    parsed.data.action !== "exception_requested" &&
    !isWithinWindow(
      new Date(),
      session.starts_at,
      session.ends_at,
      parsed.data.action,
    )
  ) {
    return NextResponse.json(
      { error: "OUTSIDE_ATTENDANCE_WINDOW" },
      { status: 409 },
    );
  }
  if (
    parsed.data.action === "check_in" &&
    (!parsed.data.equipment?.camera ||
      !parsed.data.equipment.microphone ||
      !parsed.data.equipment.speaker)
  ) {
    await admin
      .from("live_attendance_events")
      .insert({
        live_session_id: sessionId,
        learner_id: userId,
        booking_id: booking.id,
        event_type: "equipment_failed",
        source: "meeting_sdk",
        source_event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        payload: parsed.data.equipment ?? {},
      });
    return NextResponse.json(
      {
        error: "EQUIPMENT_CHECK_REQUIRED",
        message:
          "攝影機、麥克風與喇叭都通過後才能自動簽到；若設備故障可提出異常申請。",
      },
      { status: 409 },
    );
  }
  const sourceEventId = `learner:${booking.id}:${parsed.data.action}:${crypto.randomUUID()}`;
  const { error } = await admin.from("live_attendance_events").insert({
    live_session_id: sessionId,
    learner_id: userId,
    booking_id: booking.id,
    event_type: parsed.data.action,
    source: "learner_action",
    source_event_id: sourceEventId,
    occurred_at: new Date().toISOString(),
    payload:
      parsed.data.action === "exception_requested"
        ? { reason: parsed.data.reason }
        : { equipment: parsed.data.equipment },
  });
  if (error)
    return NextResponse.json(
      { error: "ATTENDANCE_WRITE_FAILED" },
      { status: 500 },
    );
  const enterpriseSeat =
    parsed.data.action === "check_in"
      ? await consumeEnterpriseAllocation(admin, userId, {
          bookingId: booking.id,
        })
      : undefined;
  const summary = await recomputeLiveAttendance(admin, booking.id);
  return NextResponse.json({ ok: true, summary, enterpriseSeat });
}
