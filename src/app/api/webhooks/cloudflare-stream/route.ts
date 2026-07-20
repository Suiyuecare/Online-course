import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function verify(header: string | null, body: string, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=", 2)),
  );
  if (!parts.time || !parts.sig1 || !/^\d+$/.test(parts.time)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(parts.time)) > 300)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${parts.time}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.sig1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  const admin = createSupabaseAdminClient();
  if (!secret || !admin)
    return NextResponse.json(
      { error: "STREAM_NOT_CONFIGURED" },
      { status: 503 },
    );
  const body = await request.text();
  if (!verify(request.headers.get("Webhook-Signature"), body, secret))
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 403 });
  const payload = JSON.parse(body) as {
    uid?: string;
    readyToStream?: boolean;
    duration?: number;
    status?: {
      state?: string;
      errorReasonCode?: string;
      errorReasonText?: string;
      errReasonCode?: string;
      errReasonText?: string;
    };
  };
  if (!payload.uid)
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  const failed =
    payload.status?.state === "error" ||
    Boolean(payload.status?.errorReasonCode ?? payload.status?.errReasonCode);
  const ready =
    payload.readyToStream === true || payload.status?.state === "ready";
  const status = failed ? "failed" : ready ? "ready" : "processing";
  const { data: asset, error } = await admin
    .from("video_assets")
    .update({
      status,
      duration_seconds: payload.duration
        ? Math.round(payload.duration)
        : undefined,
      error_code:
        payload.status?.errorReasonCode ??
        payload.status?.errReasonCode ??
        null,
      error_message:
        payload.status?.errorReasonText ??
        payload.status?.errReasonText ??
        null,
      ready_at: ready ? new Date().toISOString() : null,
    })
    .eq("stream_uid", payload.uid)
    .select("id,lesson_id")
    .maybeSingle();
  if (error || !asset)
    return NextResponse.json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  if (ready)
    await admin
      .from("lessons")
      .update({ active_video_asset_id: asset.id, stream_uid: payload.uid })
      .eq("id", asset.lesson_id);
  return NextResponse.json({ ok: true });
}
