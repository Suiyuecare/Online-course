import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLearnerProfessionalRolePair,
  learnerAccountSettingsInputSchema,
  learnerInterestOptions,
  learnerProfessionalRoleCatalog,
} from "@/domain/learner-account-settings";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const validInput = {
  expectedVersion: 0,
  gender: "female",
  birthDate: "1962-05-14",
  currentStatus: "care_professional",
  professionalRoles: [{ category: "long_term_care", title: "care_worker" }],
  learningGoals: ["earn_credits", "care_skills"],
  interests: ["daily_care", "special_needs"],
} as const;

describe("learner account settings contract", () => {
  it("accepts controlled long-term-care profile values", () => {
    expect(
      learnerAccountSettingsInputSchema.safeParse(validInput).success,
    ).toBe(true);
    expect(learnerProfessionalRoleCatalog).toHaveLength(5);
    expect(learnerInterestOptions).toHaveLength(8);
    expect(isLearnerProfessionalRolePair("long_term_care", "care_worker")).toBe(
      true,
    );
    expect(isLearnerProfessionalRolePair("medical_health", "care_worker")).toBe(
      false,
    );
  });

  it("rejects invalid pairs, duplicate values and oversized preference lists", () => {
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        professionalRoles: [
          { category: "medical_health", title: "care_worker" },
        ],
      }).success,
    ).toBe(false);
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        learningGoals: ["earn_credits", "earn_credits"],
      }).success,
    ).toBe(false);
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        interests: [
          "career_entry",
          "daily_care",
          "special_needs",
          "reablement",
          "quality_safety",
          "supervision_management",
          "ethics_rights",
          "policy_law",
          "daily_care",
        ],
      }).success,
    ).toBe(false);
  });

  it("requires sensitive fields to be replaced together and validates dates", () => {
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        birthDate: undefined,
      }).success,
    ).toBe(false);
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        gender: undefined,
        birthDate: undefined,
      }).success,
    ).toBe(true);
    expect(
      learnerAccountSettingsInputSchema.safeParse({
        ...validInput,
        birthDate: "2099-01-01",
      }).success,
    ).toBe(false);
  });

  it("authorizes before KMS and never returns encrypted profile material", () => {
    const route = source("src/app/api/profile/account/route.ts");
    expect(route).toContain("export async function PATCH");
    expect(route).toContain('"require_current_person"');
    expect(route.indexOf('"require_current_person"')).toBeLessThan(
      route.indexOf("encryptSensitivePayload("),
    );
    expect(route).toContain("serviceSupabase()");
    expect(route).toContain('"upsert_learner_account_settings_for_person"');
    expect(route).toContain(
      'input.gender === "undisclosed" && input.birthDate === null',
    );
    expect(route).toContain(
      "sensitiveProfileIsEmpty && input.expectedVersion === 0",
    );
    expect(route).not.toContain("return encryptedProfile");

    const application = source("src/application/learner-account-settings.ts");
    expect(application).toContain('"read_own_learner_account_settings"');
    expect(application).toContain('"read_learner_account_pii"');
    expect(application).toContain("decryptSensitivePayload(");
    expect(application).not.toContain(
      "encryptedProfile: privateResult.data.encryptedProfile",
    );
  });

  it("keeps browser writes narrow and optional profile data encrypted", () => {
    const migration = source(
      "supabase/migrations/20260728154230_learner_account_settings.sql",
    );
    expect(migration).toContain("create table public.learner_account_settings");
    expect(migration).toContain(
      "create table public.learner_professional_roles",
    );
    expect(migration).toContain("create table private.learner_account_pii");
    expect(migration).toContain(
      "alter table public.learner_account_settings force row level security",
    );
    expect(migration).toContain(
      "using (person_id = (select internal.request_person_id()))",
    );
    expect(migration).toContain(
      "create or replace function public.upsert_own_learner_account_settings",
    );
    expect(migration).toContain("LEARNER_ACCOUNT_SETTINGS_VERSION_CONFLICT");
    expect(migration).toContain(
      "grant execute on function public.read_learner_account_pii(uuid)",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*?learner_account_settings[\s\S]*?authenticated/i,
    );
    const rlsCapability = source(
      "supabase/migrations/20260728154702_fix_request_person_id_rls_capability.sql",
    );
    expect(rlsCapability).toContain(
      "grant execute on function internal.request_person_id()",
    );
    expect(rlsCapability).toContain("to authenticated");
    expect(rlsCapability).not.toMatch(/to\s+anon/);
    const auditCapability = source(
      "supabase/migrations/20260728154828_fix_audit_owner_digest_capability.sql",
    );
    expect(auditCapability).toContain(
      "grant usage on schema extensions to suiyue_audit_owner",
    );
    expect(auditCapability).toContain(
      "grant execute on function extensions.digest(text, text)",
    );
    expect(auditCapability).not.toMatch(
      /grant\s+(?:select|insert|update|delete)\b/i,
    );
    const serverWriteBoundary = source(
      "supabase/migrations/20260728161422_lock_learner_account_settings_server_write.sql",
    );
    expect(serverWriteBoundary).toContain(
      "revoke all on function public.upsert_own_learner_account_settings",
    );
    expect(serverWriteBoundary).toContain(
      "create or replace function public.upsert_learner_account_settings_for_person",
    );
    expect(serverWriteBoundary).toContain(
      "LEARNER_ACCOUNT_SETTINGS_IDENTITY_RESTRICTED",
    );
    expect(serverWriteBoundary).toContain("to service_role");
    expect(serverWriteBoundary).not.toMatch(
      /grant\s+execute[\s\S]*?upsert_learner_account_settings_for_person[\s\S]*?to\s+authenticated/i,
    );
  });

  it("ships the complete private account center on desktop and mobile", () => {
    const center = source("src/components/account-settings-center.tsx");
    const styles = source("src/app/globals.css");
    const page = source("src/app/learner/settings/page.tsx");
    for (const label of [
      "聯絡資訊",
      "基本資料",
      "職業資訊",
      "新增職務",
      "學習目標",
      "有興趣的領域",
      "登入與安全",
      "閱讀偏好",
      "儲存變更",
    ]) {
      expect(center).toContain(label);
    }
    expect(center).toContain('href="/legal#privacy"');
    expect(center).toContain('method: "PATCH"');
    expect(center).toContain("response.status === 409");
    expect(center).toContain('"beforeunload"');
    expect(center).toContain("window.confirm");
    expect(center).toContain("emailDirty");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("min-height: 44px");
    expect(page).toContain("readOwnLearnerAccountSettings");
    expect(page).toContain("避免用空白內容覆蓋既有設定");
  });
});
