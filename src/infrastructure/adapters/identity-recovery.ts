import { z } from "zod";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

const completion = z.object({
  replacementAuthUserId: z.uuid(),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export class IdentityRecoveryAdapter {
  private readonly config = serverConfig();

  async complete(input: { recoveryCaseId: string; idempotencyKey: string }) {
    if (
      localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      throw new Error("LOCAL_IDENTITY_RECOVERY_REQUIRES_EXPLICIT_FIXTURE");
    }
    const endpoint = this.config.IDENTITY_RECOVERY_ENDPOINT;
    const token = this.config.IDENTITY_RECOVERY_TOKEN;
    if (!endpoint || !token) {
      throw new Error("IDENTITY_RECOVERY_PROVIDER_UNAVAILABLE");
    }
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/v1/recoveries/${encodeURIComponent(
        input.recoveryCaseId,
      )}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          requireVerifiedReplacementPhone: true,
          revokeAllSessions: true,
          resetTotp: true,
        }),
        cache: "no-store",
      },
    );
    const result = completion.safeParse(
      await response.json().catch(() => null),
    );
    if (!response.ok || !result.success) {
      throw new Error("IDENTITY_RECOVERY_PROVIDER_FAILED");
    }
    return result.data;
  }
}
