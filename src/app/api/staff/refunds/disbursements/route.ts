import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        refundCaseId: z.uuid(),
        allocationId: z.uuid(),
        amountTwd: z.number().int().positive(),
        externalReference: z.string().trim().min(3).max(200),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("record_refund_disbursement", {
      p_refund_allocation_id: input.allocationId,
      p_amount_twd: input.amountTwd,
      p_external_reference: input.externalReference,
      p_idempotency_key: requireIdempotencyKey(request),
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("REFUND_DISBURSEMENT_REJECTED");
    return data;
  });
}
