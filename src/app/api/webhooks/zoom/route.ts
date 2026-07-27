import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readRequestTextWithLimit,
  webhookRequestBodyLimitBytes,
} from "@/domain/request-body";
import { serverConfig } from "@/infrastructure/config";
import { verifyTimestampedHmac } from "@/infrastructure/security/signatures";
import { ingestProviderEvent } from "@/infrastructure/supabase/provider-events";

export async function POST(request: Request) {
  const config = serverConfig();
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
    event?: string;
    event_ts?: number;
    payload?: {
      plainToken?: string;
      account_id?: string;
      object?: {
        uuid?: string;
        participant?: {
          participant_uuid?: string;
          customer_key?: string;
          join_time?: string;
          leave_time?: string;
        };
      };
    };
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  if (
    !verifyTimestampedHmac({
      body,
      timestamp: request.headers.get("x-zm-request-timestamp"),
      signature: request.headers.get("x-zm-signature"),
      secret: config.ZOOM_WEBHOOK_SECRET_TOKEN,
    })
  ) {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }
  if (payload.event === "endpoint.url_validation") {
    const plainToken = payload.payload?.plainToken;
    if (!plainToken || !config.ZOOM_WEBHOOK_SECRET_TOKEN) {
      return NextResponse.json({ accepted: false }, { status: 401 });
    }
    return NextResponse.json({
      plainToken,
      encryptedToken: createHmac("sha256", config.ZOOM_WEBHOOK_SECRET_TOKEN)
        .update(plainToken)
        .digest("hex"),
    });
  }
  if (
    !payload.event ||
    ![
      "meeting.started",
      "meeting.ended",
      "meeting.participant_joined",
      "meeting.participant_left",
    ].includes(payload.event) ||
    (config.ZOOM_ACCOUNT_ID &&
      payload.payload?.account_id !== config.ZOOM_ACCOUNT_ID)
  ) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  const object = payload.payload?.object;
  const participant = object?.participant;
  await ingestProviderEvent({
    provider: "zoom",
    eventType: payload.event ?? "unknown",
    nativeEventId: null,
    occurredAt:
      (payload.event === "meeting.participant_left"
        ? participant?.leave_time
        : participant?.join_time) ??
      (payload.event_ts ? new Date(payload.event_ts).toISOString() : null),
    payload: {
      ...payload,
      deduplication: {
        accountId: payload.payload?.account_id,
        meetingUuid: object?.uuid,
        participantUuid: participant?.participant_uuid,
        customerKey: participant?.customer_key,
      },
    },
    environment: config.APP_ENV,
  });
  return NextResponse.json({ accepted: true });
}
