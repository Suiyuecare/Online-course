import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { recomputeLiveAttendance } from "@/lib/live";
import { verifyZoomWebhook, zoomCrcResponse } from "@/lib/zoom";

type ZoomEvent = {
  event?: string;
  event_ts?: number;
  payload?: {
    plainToken?: string;
    object?: {
      id?: string | number;
      uuid?: string;
      start_time?: string;
      end_time?: string;
      participant?: {
        customer_key?: string;
        join_time?: string;
        leave_time?: string;
        id?: string;
        user_id?: string;
      };
    };
  };
};

export async function POST(request: Request) {
  if (process.env.FEATURE_LIVE_COURSES !== "true")
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  if (!process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    return NextResponse.json({ error: "ZOOM_NOT_CONFIGURED" }, { status: 503 });
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-zm-request-timestamp");
  const signature = request.headers.get("x-zm-signature");
  if (!verifyZoomWebhook(rawBody, timestamp, signature))
    return NextResponse.json(
      { error: "INVALID_ZOOM_SIGNATURE" },
      { status: 403 },
    );
  const event = JSON.parse(rawBody) as ZoomEvent;
  if (event.event === "endpoint.url_validation" && event.payload?.plainToken)
    return NextResponse.json(zoomCrcResponse(event.payload.plainToken));
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const meetingNumber = String(event.payload?.object?.id ?? "");
  const { data: session } = meetingNumber
    ? await admin
        .from("live_sessions")
        .select("id,status")
        .eq("zoom_meeting_id", meetingNumber)
        .maybeSingle()
    : { data: null };
  if (!session)
    return NextResponse.json(
      { accepted: false, reason: "UNKNOWN_MEETING" },
      { status: 202 },
    );
  const eventKey = createHash("sha256").update(rawBody).digest("hex");
  const { error: rawError } = await admin
    .from("zoom_webhook_events")
    .insert({
      event_key: eventKey,
      event_type: event.event ?? "unknown",
      live_session_id: session.id,
      occurred_at: event.event_ts
        ? new Date(event.event_ts).toISOString()
        : new Date().toISOString(),
      payload: event,
    });
  if (rawError?.code === "23505")
    return NextResponse.json({ accepted: true, duplicate: true });
  if (rawError)
    return NextResponse.json(
      { error: "ZOOM_EVENT_STORE_FAILED" },
      { status: 500 },
    );
  if (event.event === "meeting.started")
    await admin
      .from("live_sessions")
      .update({ status: "open" })
      .eq("id", session.id)
      .in("status", ["scheduled", "open"]);
  if (event.event === "meeting.ended")
    await admin
      .from("live_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", session.id)
      .neq("status", "cancelled");
  const normalizedType =
    event.event === "meeting.participant_joined"
      ? "joined"
      : event.event === "meeting.participant_left"
        ? "left"
        : null;
  if (normalizedType) {
    const customerKey = event.payload?.object?.participant?.customer_key;
    if (!customerKey)
      return NextResponse.json(
        { accepted: false, reason: "MISSING_CUSTOMER_KEY" },
        { status: 202 },
      );
    const { data: booking } = await admin
      .from("live_session_bookings")
      .select("id,learner_id,status")
      .eq("live_session_id", session.id)
      .eq("customer_key", customerKey)
      .maybeSingle();
    if (!booking || booking.status !== "confirmed")
      return NextResponse.json(
        { accepted: false, reason: "UNKNOWN_CUSTOMER_KEY" },
        { status: 202 },
      );
    const participant = event.payload?.object?.participant;
    const occurredAt =
      normalizedType === "joined"
        ? participant?.join_time
        : participant?.leave_time;
    await admin
      .from("live_attendance_events")
      .insert({
        live_session_id: session.id,
        learner_id: booking.learner_id,
        booking_id: booking.id,
        event_type: normalizedType,
        source: "zoom_webhook",
        source_event_id: eventKey,
        occurred_at: occurredAt ?? new Date().toISOString(),
        payload: participant ?? {},
      });
    after(() => recomputeLiveAttendance(admin, booking.id).catch(() => undefined));
  }
  return NextResponse.json({ accepted: true });
}
