import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { SupabasePhoneAuthAdapter } from "@/infrastructure/adapters/phone-auth";
import { IdentityRiskAdapter } from "@/infrastructure/adapters/identity-risk";
import {
  serviceSupabase,
  userSupabase,
} from "@/infrastructure/supabase/server";

const requestSchema = z.object({
  phone: z.string().regex(/^\+8869\d{8}$/),
  token: z.string().regex(/^\d{6}$/),
  deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const client = await userSupabase();
    const input = await readJson(request, requestSchema);
    const user = await new SupabasePhoneAuthAdapter(client).verifyOtp(
      input.phone,
      input.token,
    );
    const riskDecision = await new IdentityRiskAdapter().assess({
      authUserId: user.id,
      deviceHash: input.deviceHash,
    });
    const { data, error } = await serviceSupabase().rpc(
      "assess_post_otp_identity",
      {
        p_auth_user_id: user.id,
        p_device_hash: input.deviceHash,
        p_risk_decision: riskDecision,
      },
    );
    const assessment = z
      .object({
        restricted: z.boolean(),
        reason: z.string().nullable(),
      })
      .safeParse(data);
    if (error || !assessment.success) {
      await client.auth.signOut({ scope: "local" });
      throw new Error("IDENTITY_RISK_ASSESSMENT_FAILED");
    }
    return {
      signedIn: true,
      userId: user.id,
      restricted: assessment.data.restricted,
    };
  });
}
