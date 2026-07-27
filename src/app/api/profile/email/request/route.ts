import { createHmac, randomInt } from "node:crypto";
import { render } from "@react-email/render";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { localProvidersAllowed } from "@/domain/identity";
import { VerificationCodeEmail } from "@/emails/verification-code";
import { ResendNotificationAdapter } from "@/infrastructure/adapters/notifications";
import { serverConfig } from "@/infrastructure/config";
import { requireUser } from "@/infrastructure/supabase/server";

function clientIp(request: Request) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const value = request.headers.get("x-real-ip") ?? forwarded;
  if (!value || !/^[0-9a-f:.]+$/i.test(value)) {
    throw new Error("CLIENT_IP_UNAVAILABLE");
  }
  return value;
}

function codeHmac(email: string, code: string, secret: string) {
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

export async function POST(request: Request) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const { email: submittedEmail } = await readJson(
      request,
      z.object({ email: z.email().max(320) }),
    );
    const email = submittedEmail.trim().toLowerCase();
    const config = serverConfig();
    const secret = config.EMAIL_VERIFICATION_HMAC_SECRET;
    if (!secret) throw new Error("EMAIL_VERIFICATION_UNAVAILABLE");
    const local = localProvidersAllowed({
      nodeEnv: process.env.NODE_ENV,
      appEnv: process.env.APP_ENV,
      allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
    });
    const code =
      local && config.LOCAL_EMAIL_VERIFICATION_CODE
        ? config.LOCAL_EMAIL_VERIFICATION_CODE
        : randomInt(0, 1_000_000).toString().padStart(6, "0");
    const { supabase } = await requireUser();
    const { data: challengeId, error } = await supabase.rpc(
      "start_email_verification",
      {
        p_normalized_email: email,
        p_code_hmac: codeHmac(email, code, secret),
        p_request_ip: clientIp(request),
      },
    );
    if (error || !challengeId) throw new Error("EMAIL_VERIFICATION_REJECTED");
    if (!local) {
      await new ResendNotificationAdapter().deliver({
        to: email,
        subject: "歲悅學苑 Email 驗證碼",
        html: await render(VerificationCodeEmail({ code })),
        idempotencyKey: `email-verification:${challengeId}`,
      });
    }
    return { sent: true, expiresAfterSeconds: 600, localDelivery: local };
  });
}
