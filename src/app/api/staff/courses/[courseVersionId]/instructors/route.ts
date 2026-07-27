import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  instructorRoleId: z.uuid(),
  displayName: z.string().trim().min(2).max(100),
  biography: z.string().trim().min(10).max(3000),
  credentials: z.string().trim().min(5).max(1000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  return mutation(request, async () => {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("bind_course_instructor", {
      p_course_version_id: courseVersionId,
      p_instructor_role_id: input.instructorRoleId,
      p_display_name: input.displayName,
      p_biography: input.biography,
      p_credentials: input.credentials,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("COURSE_INSTRUCTOR_BIND_REJECTED");
    return data;
  });
}
