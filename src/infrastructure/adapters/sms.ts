import { createHash } from "node:crypto";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

export class TwilioMessagingAdapter {
  private readonly config = serverConfig();

  async send(input: {
    to: string;
    body: string;
    idempotencyKey: string;
    statusCallback?: string;
  }) {
    const accountSid = this.config.TWILIO_ACCOUNT_SID;
    const authToken = this.config.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = this.config.TWILIO_MESSAGING_SERVICE_SID;
    if (!accountSid || !authToken || !messagingServiceSid) {
      throw new Error("SMS_PROVIDER_UNAVAILABLE");
    }
    const form = new URLSearchParams({
      To: input.to,
      Body: input.body,
      MessagingServiceSid: messagingServiceSid,
    });
    if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": input.idempotencyKey,
        },
        body: form,
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      sid?: string;
      status?: string;
    } | null;
    if (!response.ok || !payload?.sid) throw new Error("SMS_DELIVERY_FAILED");
    return { providerMessageId: payload.sid, status: payload.status };
  }
}

export class LocalMessagingAdapter {
  async send(input: { idempotencyKey: string }) {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      throw new Error("LOCAL_SMS_DISABLED");
    }
    return {
      providerMessageId: `local-sms-${createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex")
        .slice(0, 24)}`,
      status: "delivered",
    };
  }
}

export function messagingAdapter() {
  return localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  })
    ? new LocalMessagingAdapter()
    : new TwilioMessagingAdapter();
}
