import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  learnerAccountSensitiveProfileSchema,
  learnerCurrentStatusCodeSchema,
  learnerGenderCodeSchema,
  learnerInterestCodeSchema,
  learnerLearningGoalCodeSchema,
  learnerProfessionalCategoryCodeSchema,
  learnerProfessionalTitleCodeSchema,
  isLearnerProfessionalRolePair,
} from "@/domain/learner-account-settings";
import { decryptSensitivePayload } from "@/infrastructure/security/sensitive-envelope";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const learnerAccountRoleReadSchema = z
  .object({
    id: z.uuid(),
    category: learnerProfessionalCategoryCodeSchema,
    title: learnerProfessionalTitleCodeSchema,
  })
  .strict()
  .refine(
    ({ category, title }) => isLearnerProfessionalRolePair(category, title),
    { message: "PROFESSIONAL_ROLE_PAIR_INVALID" },
  );

const learnerAccountSettingsReadSchema = z.object({
  personId: z.uuid(),
  verifiedEmail: z.email().nullable(),
  emailVerifiedAt: z.string().nullable(),
  currentStatus: learnerCurrentStatusCodeSchema,
  professionalRoles: z.array(learnerAccountRoleReadSchema).max(5),
  learningGoals: z.array(learnerLearningGoalCodeSchema).max(3),
  interests: z.array(learnerInterestCodeSchema).max(8),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
});

const learnerAccountPrivateReadSchema = z.object({
  encryptedProfile: z.unknown().nullable(),
});

export const learnerAccountSettingsViewSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable(),
  maskedPhone: z.string().nullable(),
  phoneVerified: z.boolean(),
  verifiedEmail: z.string().nullable(),
  emailVerified: z.boolean(),
  gender: learnerGenderCodeSchema,
  birthDate: z.iso.date().nullable(),
  currentStatus: learnerCurrentStatusCodeSchema,
  professionalRoles: z.array(learnerAccountRoleReadSchema).max(5),
  learningGoals: z.array(learnerLearningGoalCodeSchema).max(3),
  interests: z.array(learnerInterestCodeSchema).max(8),
  version: z.number().int().nonnegative(),
});

export type LearnerAccountSettingsView = z.infer<
  typeof learnerAccountSettingsViewSchema
>;

export type LearnerAccountIdentity = {
  accountId: string;
  displayName: string;
  avatarUrl?: string | null;
  maskedPhone?: string | null;
  phoneVerified: boolean;
};

export async function readOwnLearnerAccountSettings(
  client: SupabaseClient,
  identity: LearnerAccountIdentity,
): Promise<LearnerAccountSettingsView> {
  const { data, error } = await client.rpc("read_own_learner_account_settings");
  const parsed = learnerAccountSettingsReadSchema.safeParse(data);
  if (error || !parsed.success) {
    throw new Error("LEARNER_ACCOUNT_SETTINGS_UNAVAILABLE");
  }

  const { data: privateData, error: privateError } =
    await serviceSupabase().rpc("read_learner_account_pii", {
      p_person_id: parsed.data.personId,
    });
  const privateResult = learnerAccountPrivateReadSchema.safeParse(privateData);
  if (privateError || !privateResult.success) {
    throw new Error("LEARNER_ACCOUNT_SETTINGS_UNAVAILABLE");
  }

  let sensitiveProfile: z.infer<typeof learnerAccountSensitiveProfileSchema> = {
    schemaVersion: 1,
    gender: "undisclosed",
    birthDate: null,
  };
  if (privateResult.data.encryptedProfile) {
    try {
      sensitiveProfile = learnerAccountSensitiveProfileSchema.parse(
        await decryptSensitivePayload(
          `learner-account-settings:${parsed.data.personId}`,
          privateResult.data.encryptedProfile,
        ),
      );
    } catch {
      throw new Error("LEARNER_ACCOUNT_SETTINGS_DECRYPTION_FAILED");
    }
  }

  return learnerAccountSettingsViewSchema.parse({
    accountId: identity.accountId,
    displayName: identity.displayName.trim() || "歲悅學員",
    avatarUrl: identity.avatarUrl ?? null,
    maskedPhone: identity.maskedPhone ?? null,
    phoneVerified: identity.phoneVerified,
    verifiedEmail: parsed.data.verifiedEmail,
    emailVerified: Boolean(parsed.data.emailVerifiedAt),
    gender: sensitiveProfile.gender,
    birthDate: sensitiveProfile.birthDate,
    currentStatus: parsed.data.currentStatus,
    professionalRoles: parsed.data.professionalRoles,
    learningGoals: parsed.data.learningGoals,
    interests: parsed.data.interests,
    version: parsed.data.version,
  });
}
