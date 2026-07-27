import { z } from "zod";
import { requireUser } from "@/infrastructure/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  try {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "read_anonymous_survey_aggregate",
      { p_course_version_id: courseVersionId },
    );
    const parsed = z
      .object({
        responseCount: z.number().int().nonnegative(),
        averageRatings: z.array(z.coerce.number()).max(5),
      })
      .safeParse(data);
    if (error || !parsed.success) throw new Error("SURVEY_SUMMARY_REJECTED");
    return Response.json(
      { ok: true, data: parsed.data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "SURVEY_SUMMARY_REJECTED" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
