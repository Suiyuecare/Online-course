import { z } from "zod";
import { publicConfig } from "@/infrastructure/config";
import { requireUser } from "@/infrastructure/supabase/server";

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function utc(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  try {
    const { liveSessionId } = await context.params;
    z.uuid().parse(liveSessionId);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("read_live_calendar_event", {
      p_live_session_id: liveSessionId,
    });
    const event = z
      .object({
        liveSessionId: z.uuid(),
        title: z.string(),
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        status: z.string(),
        sequence: z.number().int().nonnegative(),
      })
      .safeParse(data);
    if (error || !event.success) throw new Error("NOT_AUTHORIZED");
    const base = publicConfig().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Suiyue Academy//Long-term Care Course//ZH-TW",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${event.data.liveSessionId}@suiyue-academy`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART:${utc(event.data.startsAt)}`,
      `DTEND:${utc(event.data.endsAt)}`,
      `SEQUENCE:${event.data.sequence}`,
      `STATUS:${event.data.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `SUMMARY:${escapeIcs(event.data.title)}`,
      `DESCRIPTION:${escapeIcs("請從歲悅學苑登入、完成設備測試後入場。")}`,
      `URL:${base}/live/${event.data.liveSessionId}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ];
    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="suiyue-${liveSessionId}.ics"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ ok: false }, { status: 404 });
  }
}
