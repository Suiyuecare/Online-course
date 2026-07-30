import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { learnerAccountSettingsInputSchema } from "@/domain/learner-account-settings";
import { encryptSensitivePayload } from "@/infrastructure/security/sensitive-envelope";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const learnerAccountWriteResultSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string(),
});

export async function PATCH(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, learnerAccountSettingsInputSchema);
    const { supabase } = await requireUser();
    const { data: personData, error: personError } = await supabase.rpc(
      "require_current_person",
    );
    const personId = z.uuid().safeParse(personData);
    if (personError || !personId.success) {
      throw new Error("IDENTITY_RESTRICTED");
    }

    const sensitiveSubmitted =
      input.gender !== undefined && input.birthDate !== undefined;
    const sensitiveProfileIsEmpty =
      input.gender === "undisclosed" && input.birthDate === null;
    const replaceSensitive =
      sensitiveSubmitted &&
      !(sensitiveProfileIsEmpty && input.expectedVersion === 0);
    const encryptedProfile =
      sensitiveSubmitted && !sensitiveProfileIsEmpty
        ? await encryptSensitivePayload(
            `learner-account-settings:${personId.data}`,
            {
              schemaVersion: 1,
              gender: input.gender,
              birthDate: input.birthDate,
            },
          )
        : null;

    const { data, error } = await serviceSupabase().rpc(
      "upsert_learner_account_settings_for_person",
      {
        p_person_id: personId.data,
        p_current_status_code: input.currentStatus,
        p_professional_roles: input.professionalRoles,
        p_learning_goal_codes: input.learningGoals,
        p_interest_codes: input.interests,
        p_encrypted_profile: encryptedProfile,
        p_replace_encrypted_profile: replaceSensitive,
        p_expected_version: input.expectedVersion,
      },
    );
    if (error || !data) {
      throw new Error(
        error?.message.includes("VERSION_CONFLICT")
          ? "LEARNER_ACCOUNT_SETTINGS_VERSION_CONFLICT"
          : "LEARNER_ACCOUNT_SETTINGS_REJECTED",
      );
    }
    return learnerAccountWriteResultSchema.parse(data);
  });
}
