import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { decryptSensitivePayload } from "@/infrastructure/security/sensitive-envelope";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const account = z.object({
  bankName: z.string(),
  bankCode: z.string().regex(/^\d{3}$/),
  accountNumber: z.string().regex(/^\d{6,20}$/),
  accountName: z.string(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ refundCaseId: string }> },
) {
  return mutation(request, async () => {
    const { refundCaseId } = await context.params;
    z.uuid().parse(refundCaseId);
    const input = await readJson(
      request,
      z.object({
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data: authorization, error } = await supabase.rpc(
      "authorize_refund_account_access",
      {
        p_refund_case_id: refundCaseId,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    const parsed = z
      .object({ grantId: z.uuid(), actorId: z.uuid() })
      .safeParse(authorization);
    if (error || !parsed.success) {
      throw new Error("REFUND_ACCOUNT_ACCESS_REJECTED");
    }
    const { data: encrypted, error: consumeError } =
      await serviceSupabase().rpc("consume_refund_account_access", {
        p_grant_id: parsed.data.grantId,
        p_refund_case_id: refundCaseId,
        p_actor_id: parsed.data.actorId,
      });
    if (consumeError || !encrypted) {
      throw new Error("REFUND_ACCOUNT_CAPABILITY_INVALID");
    }
    return account.parse(
      await decryptSensitivePayload(
        `refund-account:${refundCaseId}`,
        encrypted,
      ),
    );
  });
}
