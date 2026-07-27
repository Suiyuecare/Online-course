import { NextResponse } from "next/server";
import {
  readRequestTextWithLimit,
  webhookRequestBodyLimitBytes,
} from "@/domain/request-body";
import { serverConfig } from "@/infrastructure/config";
import { verifyCloudflareStreamWebhook } from "@/infrastructure/security/signatures";
import { ingestProviderEvent } from "@/infrastructure/supabase/provider-events";

export async function POST(request: Request) {
  const secret = serverConfig().CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  let body: string;
  try {
    body = await readRequestTextWithLimit(
      request,
      webhookRequestBodyLimitBytes,
    );
  } catch (error) {
    return NextResponse.json(
      { accepted: false },
      {
        status:
          error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE"
            ? 413
            : 400,
      },
    );
  }
  if (
    !verifyCloudflareStreamWebhook({
      body,
      header: request.headers.get("webhook-signature"),
      secret,
    })
  ) {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }
  let payload: {
    uid?: string;
    status?: { state?: string };
    modified?: string;
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  if (
    !payload.uid ||
    !payload.status?.state ||
    !["queued", "inprogress", "ready", "error", "failed"].includes(
      payload.status.state,
    )
  ) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  await ingestProviderEvent({
    provider: "cloudflare_stream",
    eventType: payload.status?.state ?? "unknown",
    nativeEventId: null,
    occurredAt: payload.modified ?? null,
    payload,
    environment: serverConfig().APP_ENV,
  });
  return NextResponse.json({ accepted: true });
}
