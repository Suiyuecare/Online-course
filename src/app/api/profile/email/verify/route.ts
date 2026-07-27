import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { serverConfig } from "@/infrastructure/config";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const input = await readJson(
      request,
      z.object({
        email: z.email().max(320),
        code: z.string().regex(/^\d{6}$/),
      }),
    );
    const email = input.email.trim().toLowerCase();
    const secret = serverConfig().EMAIL_VERIFICATION_HMAC_SECRET;
    if (!secret) throw new Error("EMAIL_VERIFICATION_UNAVAILABLE");
    const hmac = createHmac("sha256", secret)
      .update(`${email}:${input.code}`)
      .digest("hex");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("confirm_email_verification", {
      p_normalized_email: email,
      p_code_hmac: hmac,
    });
    if (error || !data) throw new Error("EMAIL_VERIFICATION_REJECTED");
    return { verified: true };
  });
}
