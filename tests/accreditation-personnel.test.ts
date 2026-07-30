import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accreditationPersonnelCatalogVersion,
  accreditationPersonnelCategoryCodeSchema,
  accreditationPersonnelCategoryGroups,
  officialAccreditationPersonnelCategoryLabel,
} from "@/domain/accreditation-personnel";
import { accreditationIdentitySchema } from "@/infrastructure/security/accreditation-identity";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const validIdentity = {
  enrollmentId: "11111111-1111-4111-8111-111111111111",
  realName: "王小明",
  nationalId: "A123456789",
  birthDate: "1980-01-02",
  careWorkerId: "CARE-1234",
  personnelCategoryCode: "care_worker",
  serviceUnit: "歲悅居家長照機構",
} as const;

describe("official accreditation personnel catalog", () => {
  it("matches the five Annex 1 groups and ten canonical categories", () => {
    expect(accreditationPersonnelCatalogVersion).toBe(
      "mohw-annex-1-2026-03-17",
    );
    expect(
      accreditationPersonnelCategoryGroups.map((group) => group.label),
    ).toEqual([
      "照顧服務人員",
      "居家服務督導人員",
      "專業服務人員",
      "照顧管理人員",
      "社區整合型服務中心個案管理人員",
    ]);
    expect(
      accreditationPersonnelCategoryGroups.flatMap((group) =>
        group.categories.map((category) => category.label),
      ),
    ).toEqual([
      "照顧服務員",
      "家庭托顧服務員",
      "居家服務督導員",
      "教保員",
      "社會工作師",
      "社會工作人員",
      "醫事人員",
      "照顧管理專員",
      "照顧管理督導",
      "社區整合型服務中心個案管理人員",
    ]);
  });

  it("resolves only controlled codes to official human labels", () => {
    expect(officialAccreditationPersonnelCategoryLabel("care_worker")).toBe(
      "照顧服務員",
    );
    expect(
      accreditationPersonnelCategoryCodeSchema.safeParse("護理師").success,
    ).toBe(false);
    expect(
      accreditationPersonnelCategoryCodeSchema.safeParse("other").success,
    ).toBe(false);
  });
});

describe("accreditation identity personnel category", () => {
  it("accepts the official category code and rejects free text", () => {
    expect(accreditationIdentitySchema.safeParse(validIdentity).success).toBe(
      true,
    );
    expect(
      accreditationIdentitySchema.safeParse({
        ...validIdentity,
        personnelCategoryCode: "照顧服務員",
      }).success,
    ).toBe(false);
    expect(
      accreditationIdentitySchema.safeParse({
        ...validIdentity,
        personnelCategoryCode: undefined,
        personnelCategory: "照顧服務員",
      }).success,
    ).toBe(false);
  });

  it("keeps the encrypted v1 label compatible and renders a grouped select", () => {
    const security = source(
      "src/infrastructure/security/accreditation-identity.ts",
    );
    const form = source("src/components/accreditation-identity-form.tsx");

    expect(security).toContain(
      "personnelCategory: officialAccreditationPersonnelCategoryLabel(",
    );
    expect(security).toContain("schemaVersion: 1");
    expect(security).toContain("personnelCategory: z.string().min(1).max(80)");
    expect(form).toContain(
      '<select name="personnelCategoryCode" defaultValue="" required>',
    );
    expect(form).toContain("accreditationPersonnelCategoryGroups.map((group)");
    expect(form).not.toContain('<input name="personnelCategory"');
  });
});
