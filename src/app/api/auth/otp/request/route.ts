import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { SupabasePhoneAuthAdapter } from "@/infrastructure/adapters/phone-auth";
import { userSupabase } from "@/infrastructure/supabase/server";

const requestSchema = z.object({
  phone: z.string().regex(/^\+8869\d{8}$/),
  turnstileToken: z.string().min(1),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, requestSchema);
    const auth = new SupabasePhoneAuthAdapter(await userSupabase());
    await auth.requestOtp(input.phone, input.turnstileToken);
    return { sent: true, resendAfterSeconds: 60, expiresAfterSeconds: 300 };
  });
}
