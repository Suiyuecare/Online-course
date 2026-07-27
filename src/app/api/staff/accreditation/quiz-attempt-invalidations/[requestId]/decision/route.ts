import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(10).max(1000),
    stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutation(request, async () => {
    const { requestId } = await context.params;
    z.uuid().parse(requestId);
    const input = await readJson(request, decisionSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "decide_quiz_attempt_invalidation",
      {
        p_request_id: requestId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: requireIdempotencyKey(request),
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    const status = z.enum(["approved", "rejected"]).safeParse(data);
    if (error || !status.success) {
      throw new Error("QUIZ_ATTEMPT_INVALIDATION_DECISION_REJECTED");
    }
    return { status: status.data };
  });
}
