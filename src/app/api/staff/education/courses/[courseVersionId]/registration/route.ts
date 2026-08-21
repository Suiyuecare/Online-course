import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { educationQualityRegistrationInputSchema } from "@/domain/education-quality";
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
      educationQualityRegistrationInputSchema,
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "update_course_registration_settings",
      {
        p_course_version_id: courseVersionId,
        p_registration_mode: input.registrationMode,
        p_external_registration_url: input.externalRegistrationUrl,
        p_registration_cta_label: input.registrationCtaLabel,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) {
      throw new Error("COURSE_REGISTRATION_SETTINGS_REJECTED");
    }
    return data;
  });
}
