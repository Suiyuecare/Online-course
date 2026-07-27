import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

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
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("decide_refund_case", {
      p_refund_case_id: refundCaseId,
      p_decision: input.decision,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("REFUND_DECISION_REJECTED");
    return { status: data };
  });
}
