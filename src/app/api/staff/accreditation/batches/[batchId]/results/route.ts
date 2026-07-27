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
        items: z
          .array(
            z.object({
              enrollmentId: z.uuid(),
              status: z.enum(["accepted", "needs_correction", "rejected"]),
              reason: z.string().trim().min(3).max(1000),
            }),
          )
          .min(1)
          .max(1000),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "record_accreditation_batch_results",
      {
        p_batch_id: batchId,
        p_items: input.items,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) throw new Error("ACCREDITATION_RESULT_REJECTED");
    return data;
  });
}
