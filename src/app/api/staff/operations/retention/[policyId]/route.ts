import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  reason: z.string().trim().min(10).max(1000),
  stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { policyId } = await context.params;
    z.string().uuid().parse(policyId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("request_retention_dry_run", {
      p_retention_policy_revision_id: policyId,
      p_reason: input.reason,
      p_idempotency_key: idempotencyKey,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("RETENTION_DRY_RUN_REJECTED");
    return data;
  });
}
