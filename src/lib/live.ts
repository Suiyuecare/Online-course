import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateLiveAttendance,
  type BreakInterval,
} from "@/lib/live-attendance";

export const LIVE_WINDOWS = {
  checkInOpenMinutes: 30,
  checkInCloseMinutes: 15,
  checkOutOpenMinutes: 15,
  checkOutCloseMinutes: 30,
  joinEarlyMinutes: 10,
} as const;

export function isWithinWindow(
  now: Date,
  startsAt: string,
  endsAt: string,
  kind: "check_in" | "check_out",
) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const time = now.getTime();
  return kind === "check_in"
    ? time >= start - LIVE_WINDOWS.checkInOpenMinutes * 60_000 &&
        time <= start + LIVE_WINDOWS.checkInCloseMinutes * 60_000
    : time >= end - LIVE_WINDOWS.checkOutOpenMinutes * 60_000 &&
        time <= end + LIVE_WINDOWS.checkOutCloseMinutes * 60_000;
}

export async function getConfirmedLiveBooking(
  admin: SupabaseClient,
  learnerId: string,
  liveSessionId: string,
) {
  const { data } = await admin
    .from("live_session_bookings")
    .select(
      "id,learner_id,live_session_id,enrollment_id,customer_key,status,live_sessions(id,course_id,title,starts_at,ends_at,status,camera_required_percent,break_intervals,zoom_status),enrollments(id,status)",
    )
    .eq("learner_id", learnerId)
    .eq("live_session_id", liveSessionId)
    .eq("status", "confirmed")
    .maybeSingle();
  return data;
}

export async function recomputeLiveAttendance(
  admin: SupabaseClient,
  bookingId: string,
) {
  const { data: booking } = await admin
    .from("live_session_bookings")
    .select(
      "id,learner_id,live_session_id,live_sessions(starts_at,ends_at,status,camera_required_percent,break_intervals)",
    )
    .eq("id", bookingId)
    .single();
  if (!booking) throw new Error("BOOKING_NOT_FOUND");
  const session = Array.isArray(booking.live_sessions)
    ? booking.live_sessions[0]
    : booking.live_sessions;
  if (!session) throw new Error("LIVE_SESSION_NOT_FOUND");
  const [{ data: events }, { data: adjustments }] = await Promise.all([
    admin
      .from("live_attendance_events")
      .select("event_type,occurred_at,payload")
      .eq("booking_id", bookingId)
      .order("occurred_at"),
    admin
      .from("live_attendance_adjustments")
      .select(
        "decision,camera_seconds_delta,check_in_override,check_out_override,reason,created_at",
      )
      .eq("booking_id", bookingId)
      .order("created_at"),
  ]);
  const checkIn = events?.find((event) => event.event_type === "check_in");
  const checkOut = [...(events ?? [])]
    .reverse()
    .find((event) => event.event_type === "check_out");
  const hasException =
    events?.some((event) => event.event_type === "exception_requested") ??
    false;
  const correction = [...(adjustments ?? [])]
    .reverse()
    .find((item) => item.decision === "manual_correction");
  const latestAdjustment = [...(adjustments ?? [])].at(-1);
  const calculated = calculateLiveAttendance({
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    breaks: Array.isArray(session.break_intervals)
      ? (session.break_intervals as BreakInterval[])
      : [],
    thresholdPercent: Number(session.camera_required_percent ?? 80),
    cameraSecondsDelta:
      adjustments?.reduce(
        (sum, item) =>
          sum +
          (item.decision === "manual_correction"
            ? item.camera_seconds_delta
            : 0),
        0,
      ) ?? 0,
    events: (events ?? []).flatMap((event) =>
      ["joined", "left", "heartbeat"].includes(event.event_type)
        ? [
            {
              eventType: event.event_type as "joined" | "left" | "heartbeat",
              occurredAt: event.occurred_at,
              cameraOn: Boolean(
                (event.payload as { camera_on?: boolean } | null)?.camera_on,
              ),
            },
          ]
        : [],
    ),
  });
  const checkedIn = Boolean(checkIn || correction?.check_in_override);
  const checkedOut = Boolean(checkOut || correction?.check_out_override);
  const reasons = [
    !checkedIn && "未完成簽到",
    !checkedOut && "未完成簽退",
    !calculated.qualified &&
      `鏡頭時數 ${calculated.cameraPercent.toFixed(1)}% 未達 ${Number(session.camera_required_percent ?? 80)}%`,
  ].filter((reason): reason is string => Boolean(reason));
  if (latestAdjustment?.decision === "maintain_disqualified")
    reasons.push(`管理員維持不合格：${latestAdjustment.reason}`);
  const finished =
    session.status === "ended" ||
    Date.now() >
      Date.parse(session.ends_at) + LIVE_WINDOWS.checkOutCloseMinutes * 60_000;
  const attendanceStatus = latestAdjustment?.decision === "maintain_disqualified"
    ? "disqualified"
    : reasons.length
    ? hasException
      ? "needs_review"
      : finished
        ? "disqualified"
        : "pending"
    : "qualified";
  const payload = {
    booking_id: booking.id,
    live_session_id: booking.live_session_id,
    learner_id: booking.learner_id,
    checked_in_at: checkIn?.occurred_at ?? (correction?.check_in_override ? correction.created_at : null),
    checked_out_at: checkOut?.occurred_at ?? (correction?.check_out_override ? correction.created_at : null),
    online_seconds: calculated.onlineSeconds,
    camera_seconds: calculated.cameraSeconds,
    required_seconds: calculated.denominatorSeconds,
    camera_percent: Number(calculated.cameraPercent.toFixed(4)),
    attendance_status: attendanceStatus,
    reasons,
    last_calculated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("live_attendance_summaries")
    .upsert(payload, { onConflict: "booking_id" });
  if (error) throw error;
  return payload;
}
