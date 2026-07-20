import { createHmac } from "node:crypto";
import "server-only";
import {
  createZoomCrcResponse,
  createZoomWebhookSignature,
  verifyZoomWebhookRequest,
} from "@/lib/zoom-webhook-core";

let accessTokenCache: { value: string; expiresAt: number } | null = null;

export function isZoomConfigured() {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID &&
      process.env.ZOOM_CLIENT_ID &&
      process.env.ZOOM_CLIENT_SECRET &&
      process.env.ZOOM_HOST_USER_ID &&
      process.env.ZOOM_MEETING_SDK_KEY &&
      process.env.ZOOM_MEETING_SDK_SECRET &&
      process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
  );
}

async function zoomAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000)
    return accessTokenCache.value;
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret)
    throw new Error("ZOOM_OAUTH_NOT_CONFIGURED");
  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    message?: string;
  };
  if (!response.ok || !payload.access_token)
    throw new Error(payload.message ?? "ZOOM_OAUTH_FAILED");
  accessTokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return accessTokenCache.value;
}

async function zoomApi(path: string, init: RequestInit) {
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await zoomAccessToken()}`,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  if (!response.ok)
    throw new Error(payload?.message ?? `ZOOM_API_${response.status}`);
  return payload;
}

export type ZoomMeetingInput = {
  topic: string;
  startsAt: string;
  durationMinutes: number;
  timezone?: string;
};

export async function createZoomMeeting(input: ZoomMeetingInput) {
  const host = process.env.ZOOM_HOST_USER_ID;
  if (!host) throw new Error("ZOOM_HOST_NOT_CONFIGURED");
  return zoomApi(`/users/${encodeURIComponent(host)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      topic: input.topic,
      type: 2,
      start_time: input.startsAt,
      duration: input.durationMinutes,
      timezone: input.timezone ?? "Asia/Taipei",
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        jbh_time: 10,
        mute_upon_entry: true,
        waiting_room: false,
        auto_recording: "none",
        allow_participants_to_rename: false,
      },
    }),
  }) as Promise<{
    id: number;
    uuid: string;
    password: string;
    host_id: string;
  }>;
}

export async function updateZoomMeeting(
  meetingNumber: string,
  input: ZoomMeetingInput,
) {
  await zoomApi(`/meetings/${encodeURIComponent(meetingNumber)}`, {
    method: "PATCH",
    body: JSON.stringify({
      topic: input.topic,
      start_time: input.startsAt,
      duration: input.durationMinutes,
      timezone: input.timezone ?? "Asia/Taipei",
    }),
  });
}

export async function cancelZoomMeeting(meetingNumber: string) {
  await zoomApi(`/meetings/${encodeURIComponent(meetingNumber)}`, {
    method: "DELETE",
  });
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export function createMeetingSdkSignature(
  meetingNumber: string,
  role: 0 | 1 = 0,
) {
  const sdkKey = process.env.ZOOM_MEETING_SDK_KEY;
  const sdkSecret = process.env.ZOOM_MEETING_SDK_SECRET;
  if (!sdkKey || !sdkSecret) throw new Error("ZOOM_MEETING_SDK_NOT_CONFIGURED");
  const issuedAt = Math.floor(Date.now() / 1000) - 30;
  const expiresAt = issuedAt + 60 * 60 * 2;
  const unsigned = `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ sdkKey, appKey: sdkKey, mn: meetingNumber, role, iat: issuedAt, exp: expiresAt, tokenExp: expiresAt }))}`;
  const signature = createHmac("sha256", sdkSecret)
    .update(unsigned)
    .digest("base64url");
  return { signature: `${unsigned}.${signature}`, sdkKey, expiresAt };
}

export function zoomWebhookSignature(
  rawBody: string,
  timestamp: string,
  secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "",
) {
  return createZoomWebhookSignature(rawBody, timestamp, secret);
}

export function verifyZoomWebhook(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  now = Date.now(),
) {
  return verifyZoomWebhookRequest({
    rawBody,
    timestamp,
    signature,
    secret: process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "",
    now,
  });
}

export function zoomCrcResponse(plainToken: string) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) throw new Error("ZOOM_WEBHOOK_NOT_CONFIGURED");
  return createZoomCrcResponse(plainToken, secret);
}
