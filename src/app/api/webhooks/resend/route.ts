import { NextResponse } from "next/server";
import { Webhook } from "svix";
import {
  readRequestTextWithLimit,
  webhookRequestBodyLimitBytes,
} from "@/domain/request-body";
import { serverConfig } from "@/infrastructure/config";
import { ingestProviderEvent } from "@/infrastructure/supabase/provider-events";

export async function POST(request: Request) {
  const secret = serverConfig().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ accepted: false }, { status: 503 });
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
  let payload: {
    type?: string;
    created_at?: string;
    data?: { email_id?: string };
  };
  try {
    payload = new Webhook(secret).verify(body, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as typeof payload;
  } catch {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }
  if (
    !payload.type ||
    ![
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.bounced",
      "email.complained",
      "email.suppressed",
    ].includes(payload.type)
  ) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  await ingestProviderEvent({
    provider: "resend",
    eventType: payload.type ?? "unknown",
    nativeEventId: request.headers.get("svix-id"),
    occurredAt: payload.created_at ?? null,
    payload,
    environment: serverConfig().APP_ENV,
  });
  return NextResponse.json({ accepted: true });
}
