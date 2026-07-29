import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const learnerCenterRowSchema = z.object({
  enrollment_id: z.string().uuid(),
  course_title: z.string(),
  delivery_type: z.enum(["recorded", "live", "hybrid"]),
  enrollment_status: z.string(),
  confirmed_valid_seconds: z.number().int().nonnegative(),
  required_seconds: z.number().int().nonnegative(),
  next_live_starts_at: z.string().nullable(),
  certificate_status: z.string().nullable(),
  certificate_id: z.string().uuid().nullable(),
  course_version_id: z.string().uuid(),
  course_slug: z.string(),
  completed_at: z.string().nullable(),
  has_cover: z.boolean(),
  completion_due_at: z.string().nullable(),
});

export type LearnerCenterRow = z.infer<typeof learnerCenterRowSchema>;

export async function readLearnerCenterRows(client: SupabaseClient) {
  const { data, error } = await client
    .from("learner_dashboard")
    .select(
      "enrollment_id,course_title,delivery_type,enrollment_status,confirmed_valid_seconds,required_seconds,next_live_starts_at,certificate_status,certificate_id,course_version_id,course_slug,completed_at,has_cover,completion_due_at",
    );
  if (error) throw new Error(`LEARNER_CENTER_UNAVAILABLE:${error.message}`);
  const parsed = z.array(learnerCenterRowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("LEARNER_CENTER_INVALID");
  return parsed.data;
}
