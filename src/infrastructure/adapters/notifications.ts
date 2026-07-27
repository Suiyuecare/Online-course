import { createHash } from "node:crypto";
import { Resend } from "resend";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

export class ResendNotificationAdapter {
  private config = serverConfig();

  async deliver(input: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
  }) {
    if (!this.config.RESEND_API_KEY || !this.config.RESEND_FROM_EMAIL) {
      throw new Error("EMAIL_PROVIDER_UNAVAILABLE");
    }
    const resend = new Resend(this.config.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
      {
        from: this.config.RESEND_FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        html: input.html,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (error || !data) throw new Error("EMAIL_DELIVERY_FAILED");
    return data;
  }
}

export class LocalNotificationAdapter {
  async deliver(input: { idempotencyKey: string }) {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      throw new Error("LOCAL_NOTIFICATION_DISABLED");
    }
    return {
      id: `local-email-${createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex")
        .slice(0, 24)}`,
    };
  }
}

export function notificationAdapter() {
  return localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  })
    ? new LocalNotificationAdapter()
    : new ResendNotificationAdapter();
}
