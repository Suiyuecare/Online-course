import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

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
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("decide_point_refund", {
      p_point_refund_case_id: pointRefundCaseId,
      p_decision: input.decision,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("POINT_REFUND_DECISION_REJECTED");
    return { status: data };
  });
}
