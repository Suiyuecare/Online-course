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
  context: { params: Promise<{ pointRefundCaseId: string }> },
) {
  return mutation(request, async () => {
    const { pointRefundCaseId } = await context.params;
    z.uuid().parse(pointRefundCaseId);
    const input = await readJson(
      request,
      z.object({
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data: authorization, error } = await supabase.rpc(
      "authorize_point_refund_account_access",
      {
        p_point_refund_case_id: pointRefundCaseId,
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
      throw new Error("POINT_REFUND_ACCOUNT_ACCESS_REJECTED");
    }
    const { data: encrypted, error: consumeError } =
      await serviceSupabase().rpc("consume_point_refund_account_access", {
        p_grant_id: parsed.data.grantId,
        p_point_refund_case_id: pointRefundCaseId,
        p_actor_id: parsed.data.actorId,
      });
    if (consumeError || !encrypted) {
      throw new Error("POINT_REFUND_ACCOUNT_CAPABILITY_INVALID");
    }
    return account.parse(
      await decryptSensitivePayload(
        `point-refund-account:${pointRefundCaseId}`,
        encrypted,
      ),
    );
  });
}
