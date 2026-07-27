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
  context: { params: Promise<{ pointRefundCaseId: string }> },
) {
  return mutation(request, async () => {
    const { pointRefundCaseId } = await context.params;
    z.uuid().parse(pointRefundCaseId);
    const input = await readJson(
      request,
      z
        .object({
          succeeded: z.boolean(),
          externalReference: z.string().trim().max(200).nullable(),
          failureReason: z.string().trim().max(1000).nullable(),
          reason: z.string().trim().min(10).max(1000),
          stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .superRefine((value, context) => {
          if (value.succeeded && !value.externalReference) {
            context.addIssue({
              code: "custom",
              path: ["externalReference"],
              message: "external reference required",
            });
          }
          if (!value.succeeded && !value.failureReason) {
            context.addIssue({
              code: "custom",
              path: ["failureReason"],
              message: "failure reason required",
            });
          }
        }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("record_point_refund_result", {
      p_point_refund_case_id: pointRefundCaseId,
      p_succeeded: input.succeeded,
      p_external_reference: input.externalReference,
      p_failure_reason: input.failureReason,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("POINT_REFUND_RESULT_REJECTED");
    return { status: data };
  });
}
