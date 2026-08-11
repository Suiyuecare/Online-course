import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(
      request,
      z.object({
        decision: z.enum(["return_for_correction", "reject"]),
        reason: z.string().trim().min(10).max(1000),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "review_course_version_submission",
      {
        p_course_version_id: courseVersionId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (error || !data) {
      throw new Error(
        `COURSE_REVIEW_DECISION_REJECTED:${error?.message ?? ""}`,
      );
    }
    return data;
  });
}
