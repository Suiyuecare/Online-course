import { getConfirmedLiveBooking } from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

function icsDate(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  const { sessionId } = await params;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!admin) return new Response("Service not configured", { status: 503 });
  const booking = await getConfirmedLiveBooking(admin, userId, sessionId);
  const session =
    booking &&
    (Array.isArray(booking.live_sessions)
      ? booking.live_sessions[0]
      : booking.live_sessions);
  if (!booking || !session)
    return new Response("Live booking required", { status: 403 });
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Suiyue Academy//Live Course//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@suiyue-academy`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(session.starts_at)}`,
    `DTEND:${icsDate(session.ends_at)}`,
    `SUMMARY:${escapeIcs(session.title)}`,
    "DESCRIPTION:請先登入歲悅學苑完成設備檢查與簽到，再於網站內加入同步教室。無需 Zoom 帳號。",
    `URL:${escapeIcs(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/live/${sessionId}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:歲悅學苑直播課將於 1 小時後開始",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="suiyue-live-${sessionId}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
