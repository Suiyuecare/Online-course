import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const requestSchema = z
  .object({
    quizAttemptId: z.uuid(),
    reason: z.string().trim().min(10).max(1000),
    stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, requestSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "request_quiz_attempt_invalidation",
      {
        p_quiz_attempt_id: input.quizAttemptId,
        p_reason: input.reason,
        p_idempotency_key: requireIdempotencyKey(request),
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    const requestId = z.uuid().safeParse(data);
    if (error || !requestId.success) {
      throw new Error("QUIZ_ATTEMPT_INVALIDATION_REQUEST_REJECTED");
    }
    return { requestId: requestId.data };
  });
}
