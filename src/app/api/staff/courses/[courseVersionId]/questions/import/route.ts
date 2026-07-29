import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const questionSchema = z
  .object({
    prompt: z.string().trim().min(5).max(2000),
    topic: z.string().trim().min(2).max(200),
    explanation: z.string().trim().min(5).max(4000),
    options: z
      .array(z.string().trim().min(1).max(1000))
      .length(4)
      .transform((options) => options as [string, string, string, string]),
    correctIndex: z.number().int().min(0).max(3),
  })
  .strict();

const importSchema = z
  .object({
    questions: z.array(questionSchema).min(1).max(200),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  return mutation(request, async () => {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(request, importSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("import_question_draft_batch", {
      p_course_version_id: courseVersionId,
      p_questions: input.questions,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("QUESTION_IMPORT_REJECTED");
    return data;
  });
}
