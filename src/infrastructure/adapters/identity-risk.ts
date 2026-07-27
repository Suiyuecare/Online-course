import { z } from "zod";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

export type IdentityRiskDecision = "trusted" | "review" | "unknown";

export class IdentityRiskAdapter {
  private readonly config = serverConfig();

  async assess(input: {
    authUserId: string;
    deviceHash: string;
  }): Promise<IdentityRiskDecision> {
    if (
      localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      return "trusted";
    }
    const endpoint = this.config.IDENTITY_RISK_ENDPOINT;
    const token = this.config.IDENTITY_RISK_TOKEN;
    if (!endpoint || !token) return "unknown";
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/v1/phone-auth/assess`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
    const result = z
      .object({ decision: z.enum(["trusted", "review"]) })
      .safeParse(await response.json().catch(() => null));
    return response.ok && result.success ? result.data.decision : "unknown";
  }
}
