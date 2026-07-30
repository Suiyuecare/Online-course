import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(10).max(1000),
  evidenceEventId: z.string().uuid(),
  stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { requestId } = await context.params;
    z.string().uuid().parse(requestId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("decide_retention_dry_run", {
      p_dry_run_request_id: requestId,
      p_decision: input.decision,
      p_reason: input.reason,
      p_operations_evidence_event_id: input.evidenceEventId,
      p_idempotency_key: idempotencyKey,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) {
      throw new Error("RETENTION_DRY_RUN_DECISION_REJECTED");
    }
    return data;
  });
}
