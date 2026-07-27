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
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(
      request,
      z.object({
        prompt: z.string().trim().min(5).max(2000),
        topic: z.string().trim().min(2).max(200),
        explanation: z.string().trim().min(5).max(4000),
        options: z.array(z.string().trim().min(1).max(1000)).length(4),
        correctIndex: z.number().int().min(0).max(3),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("add_question_to_draft", {
      p_course_version_id: courseVersionId,
      p_prompt: input.prompt,
      p_topic: input.topic,
      p_explanation: input.explanation,
      p_options: input.options,
      p_correct_index: input.correctIndex,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("QUESTION_DRAFT_REJECTED");
    return { questionId: data };
  });
}
