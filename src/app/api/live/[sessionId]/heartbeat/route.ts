import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfirmedLiveBooking, recomputeLiveAttendance } from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  cameraOn: z.boolean(),
  observedAt: z.string().datetime(),
  pageVisible: z.boolean(),
  sequence: z.number().int().nonnegative(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (process.env.FEATURE_LIVE_COURSES !== "true")
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const [userId, parsed, { sessionId }] = await Promise.all([
    getAuthenticatedUserId(),
    request
      .json()
      .catch(() => null)
      .then((body) => schema.safeParse(body)),
    params,
  ]);
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_HEARTBEAT" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
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
  const observedAt = Date.parse(parsed.data.observedAt);
  if (Math.abs(Date.now() - observedAt) > 45_000)
    return NextResponse.json({ error: "STALE_HEARTBEAT" }, { status: 409 });
  const { data: presence } = await admin
    .from("live_attendance_events")
    .select("event_type")
    .eq("booking_id", booking.id)
    .in("event_type", ["joined", "left"])
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (presence?.event_type !== "joined")
    return NextResponse.json(
      { error: "ZOOM_PRESENCE_REQUIRED" },
      { status: 409 },
    );
  const sourceEventId = `sdk:${booking.id}:${parsed.data.sequence}`;
  const { error } = await admin
    .from("live_attendance_events")
    .upsert(
      {
        live_session_id: sessionId,
        learner_id: userId,
        booking_id: booking.id,
        event_type: "heartbeat",
        source: "meeting_sdk",
        source_event_id: sourceEventId,
        occurred_at: new Date(observedAt).toISOString(),
        payload: {
          camera_on: parsed.data.cameraOn && parsed.data.pageVisible,
          page_visible: parsed.data.pageVisible,
        },
      },
      { onConflict: "source_event_id", ignoreDuplicates: true },
    );
  if (error)
    return NextResponse.json(
      { error: "HEARTBEAT_WRITE_FAILED" },
      { status: 500 },
    );
  const summary = await recomputeLiveAttendance(admin, booking.id);
  return NextResponse.json({ ok: true, summary });
}
