import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { certificateRevocationDecisionInputSchema } from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutation(request, async () => {
    const { requestId } = await context.params;
    z.uuid().parse(requestId);
    const input = await readJson(
      request,
      certificateRevocationDecisionInputSchema,
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "decide_certificate_revocation",
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
    if (error || !data) {
      throw new Error("CERTIFICATE_REVOCATION_DECISION_REJECTED");
    }
    return { status: z.enum(["approved", "rejected"]).parse(data) };
  });
}
