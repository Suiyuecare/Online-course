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
    const { reason } = await readJson(
      request,
      z.object({ reason: z.string().trim().min(10).max(1000) }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "submit_course_version_for_review",
      {
        p_course_version_id: courseVersionId,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (error || !data) throw new Error("COURSE_SUBMISSION_REJECTED");
    return data;
  });
}
