import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  return mutation(request, async () => {
    const { batchId } = await context.params;
    z.uuid().parse(batchId);
    const input = await readJson(
      request,
      z.object({
        externalReference: z.string().trim().min(3).max(500),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "mark_accreditation_batch_submitted",
      {
        p_batch_id: batchId,
        p_external_reference: input.externalReference,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || data !== "submitted") {
      throw new Error("ACCREDITATION_SUBMISSION_REJECTED");
    }
    return { status: data };
  });
}
