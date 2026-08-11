import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ sourceKind: string; sourceId: string }>;
  },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = await context.params;
    const sourceKind = z
      .enum(["durable_job", "notification_outbox"])
      .parse(params.sourceKind);
    const sourceId = z.string().uuid().parse(params.sourceId);
    const input = await readJson(
      request,
      z.object({
        action: z.enum(["retry", "acknowledge"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "act_on_operations_dead_letter",
      {
        p_source_kind: sourceKind,
        p_source_id: sourceId,
        p_action: input.action,
        p_reason: input.reason,
        p_idempotency_key: idempotencyKey,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) throw new Error("DEAD_LETTER_ACTION_REJECTED");
    return data;
  });
}
