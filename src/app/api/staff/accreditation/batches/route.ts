import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        courseVersionId: z.uuid(),
        accreditationRevisionId: z.uuid(),
        liveSessionId: z.uuid().nullable().optional(),
        templateVersion: z.string().trim().min(1).max(100),
        supersedesBatchId: z.uuid().nullable().optional(),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "create_accreditation_submission_batch",
      {
        p_course_version_id: input.courseVersionId,
        p_accreditation_revision_id: input.accreditationRevisionId,
        p_live_session_id: input.liveSessionId ?? null,
        p_template_version: input.templateVersion,
        p_supersedes_batch_id: input.supersedesBatchId ?? null,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("ACCREDITATION_BATCH_REJECTED");
    return { batchId: data };
  });
}
