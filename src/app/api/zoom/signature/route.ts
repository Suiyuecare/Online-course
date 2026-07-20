import { NextResponse } from "next/server";
import { z } from "zod";
import {
  decryptLiveSecret,
  isLiveSecretEncryptionConfigured,
} from "@/lib/live-secrets";
import { getConfirmedLiveBooking, LIVE_WINDOWS } from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";
import { createMeetingSdkSignature, isZoomConfigured } from "@/lib/zoom";

const schema = z.object({ liveSessionId: z.string().uuid() });

export async function POST(request: Request) {
  if (process.env.FEATURE_LIVE_COURSES !== "true")
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  if (!isZoomConfigured() || !isLiveSecretEncryptionConfigured())
    return NextResponse.json({ error: "ZOOM_NOT_CONFIGURED" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_LIVE_SESSION" },
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
  const booking = await getConfirmedLiveBooking(
    admin,
    userId,
    parsed.data.liveSessionId,
  );
  const session =
    booking &&
    (Array.isArray(booking.live_sessions)
      ? booking.live_sessions[0]
      : booking.live_sessions);
  const enrollment =
    booking &&
    (Array.isArray(booking.enrollments)
      ? booking.enrollments[0]
      : booking.enrollments);
  if (!booking || !session || enrollment?.status !== "active")
    return NextResponse.json(
      { error: "PAID_LIVE_BOOKING_REQUIRED" },
      { status: 403 },
    );
  if (
    !["scheduled", "open"].includes(session.status) ||
    session.zoom_status !== "ready"
  )
    return NextResponse.json(
      { error: "LIVE_SESSION_NOT_JOINABLE" },
      { status: 409 },
    );
  const now = Date.now();
  if (
    now <
      Date.parse(session.starts_at) - LIVE_WINDOWS.joinEarlyMinutes * 60_000 ||
    now >
      Date.parse(session.ends_at) + LIVE_WINDOWS.checkOutCloseMinutes * 60_000
  ) {
    return NextResponse.json({ error: "OUTSIDE_JOIN_WINDOW" }, { status: 409 });
  }
  const { data: credentials } = await admin.rpc("get_live_zoom_credentials", {
    target_session_id: parsed.data.liveSessionId,
  });
  const credential = Array.isArray(credentials) ? credentials[0] : credentials;
  if (!credential?.meeting_number || !credential.encrypted_passcode)
    return NextResponse.json(
      { error: "ZOOM_MEETING_NOT_READY" },
      { status: 503 },
    );
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const signed = createMeetingSdkSignature(credential.meeting_number, 0);
  return NextResponse.json(
    {
      ...signed,
      meetingNumber: credential.meeting_number,
      passWord: decryptLiveSecret(credential.encrypted_passcode),
      userName: profile?.full_name?.trim() || "歲悅學員",
      customerKey: booking.customer_key,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
