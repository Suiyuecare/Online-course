import type { SupabaseClient } from "@supabase/supabase-js";
import { localOtpAllowed } from "@/domain/identity";

export class SupabasePhoneAuthAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async requestOtp(phone: string, captchaToken: string) {
    if (!captchaToken) throw new Error("TURNSTILE_REQUIRED");
    const { error } = await this.client.auth.signInWithOtp({
      phone,
      options: { captchaToken, shouldCreateUser: true },
    });
    if (error) throw new Error("OTP_REQUEST_REJECTED");
  }

  async verifyOtp(phone: string, token: string) {
    const { data, error } = await this.client.auth.verifyOtp({
      phone,
      token,
      type: "sms",
    });
    if (error || !data.user) throw new Error("OTP_VERIFICATION_REJECTED");
    return data.user;
  }
}

export class LocalPhoneAuthAdapter {
  constructor(private readonly fixedOtp: string | undefined) {
    if (
      !localOtpAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
        fixedOtp,
      })
    ) {
      throw new Error("LOCAL_OTP_DISABLED");
    }
  }

  async requestOtp() {
    return { delivery: "local-console" as const };
  }

  async verifyOtp(phone: string, token: string) {
    if (token !== this.fixedOtp) throw new Error("OTP_VERIFICATION_REJECTED");
    return { id: `local:${phone}`, phone };
  }
}
