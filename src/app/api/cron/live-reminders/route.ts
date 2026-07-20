import { NextResponse } from "next/server";
import { sendLiveCourseEmail, type LiveEmailKind } from "@/lib/live-email";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (
    !expected ||
    request.headers.get("authorization") !== `Bearer ${expected}`
  )
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  await admin
    .from("live_session_bookings")
    .update({ status: "expired" })
    .eq("status", "held")
    .lte("held_until", new Date().toISOString());
  const now = Date.now();
  const upper = new Date(now + 25 * 60 * 60_000).toISOString();
  const { data: sessions } = await admin
    .from("live_sessions")
    .select("id,starts_at,live_session_bookings(id,status)")
    .in("status", ["scheduled", "open"])
    .gte("starts_at", new Date(now + 30 * 60_000).toISOString())
    .lte("starts_at", upper);
  let attempted = 0;
  let sent = 0;
  for (const session of sessions ?? []) {
    const hours = (Date.parse(session.starts_at) - now) / 3_600_000;
    const kind: LiveEmailKind | null =
      hours >= 23 && hours <= 25
        ? "reminder_24h"
        : hours >= 0.5 && hours <= 1.5
          ? "reminder_1h"
          : null;
    if (!kind) continue;
    for (const booking of session.live_session_bookings ?? [])
      if (booking.status === "confirmed") {
        attempted += 1;
        const result = await sendLiveCourseEmail(booking.id, kind, request);
        if (result.sent) sent += 1;
      }
  }
  return NextResponse.json({ ok: true, attempted, sent });
}
