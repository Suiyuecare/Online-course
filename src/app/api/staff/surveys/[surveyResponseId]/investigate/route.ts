import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import {
  surveyInvestigationInputSchema,
  surveyInvestigationResultSchema,
} from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ surveyResponseId: string }> },
) {
  return mutation(request, async () => {
    const { surveyResponseId } = await context.params;
    z.uuid().parse(surveyResponseId);
    const input = await readJson(request, surveyInvestigationInputSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("read_survey_investigation", {
      p_survey_response_id: surveyResponseId,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    const parsed = surveyInvestigationResultSchema.safeParse(data);
    if (error || !parsed.success) {
      throw new Error("SURVEY_INVESTIGATION_REJECTED");
    }
    return parsed.data;
  });
}
