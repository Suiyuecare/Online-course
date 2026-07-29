import { z } from "zod";

/**
 * 衛生福利部「長期照顧服務人員訓練認證繼續教育及登錄辦法」
 * 115 年 3 月 17 日修正之附件一。
 *
 * 「其他中央主管機關公告之人員」未列於附件一的資格表，因此不開放
 * 學員自行選取；日後如有正式公告，應以新版 catalog code 明確加入。
 */
export const accreditationPersonnelCatalogVersion =
  "mohw-annex-1-2026-03-17" as const;

export const accreditationPersonnelCategoryGroups = [
  {
    code: "care_service_personnel",
    label: "照顧服務人員",
    categories: [
      { code: "care_worker", label: "照顧服務員" },
      { code: "family_care_service_worker", label: "家庭托顧服務員" },
    ],
  },
  {
    code: "home_service_supervisory_personnel",
    label: "居家服務督導人員",
    categories: [{ code: "home_service_supervisor", label: "居家服務督導員" }],
  },
  {
    code: "professional_service_personnel",
    label: "專業服務人員",
    categories: [
      { code: "educator", label: "教保員" },
      { code: "certified_social_worker", label: "社會工作師" },
      { code: "social_work_personnel", label: "社會工作人員" },
      { code: "medical_personnel", label: "醫事人員" },
    ],
  },
  {
    code: "care_management_personnel",
    label: "照顧管理人員",
    categories: [
      { code: "care_manager", label: "照顧管理專員" },
      { code: "care_management_supervisor", label: "照顧管理督導" },
    ],
  },
  {
    code: "community_integrated_service_center_case_management_personnel",
    label: "社區整合型服務中心個案管理人員",
    categories: [
      {
        code: "community_integrated_service_center_case_manager",
        label: "社區整合型服務中心個案管理人員",
      },
    ],
  },
] as const;

export const accreditationPersonnelCategoryCodes = [
  "care_worker",
  "family_care_service_worker",
  "home_service_supervisor",
  "educator",
  "certified_social_worker",
  "social_work_personnel",
  "medical_personnel",
  "care_manager",
  "care_management_supervisor",
  "community_integrated_service_center_case_manager",
] as const;

export type AccreditationPersonnelCategoryCode =
  (typeof accreditationPersonnelCategoryCodes)[number];

type AccreditationPersonnelCategory = {
  readonly code: AccreditationPersonnelCategoryCode;
  readonly label: string;
};

const accreditationPersonnelCategories: readonly AccreditationPersonnelCategory[] =
  accreditationPersonnelCategoryGroups.flatMap((group) =>
    group.categories.map((category) => ({
      code: category.code,
      label: category.label,
    })),
  );

export const accreditationPersonnelCategoryCodeSchema = z.enum(
  accreditationPersonnelCategoryCodes,
);

export function resolveAccreditationPersonnelCategory(
  code: AccreditationPersonnelCategoryCode,
): AccreditationPersonnelCategory {
  const validatedCode = accreditationPersonnelCategoryCodeSchema.parse(code);
  const category = accreditationPersonnelCategories.find(
    (candidate) => candidate.code === validatedCode,
  );
  if (!category) {
    throw new Error("ACCREDITATION_PERSONNEL_CATEGORY_INVALID");
  }
  return category;
}

export function officialAccreditationPersonnelCategoryLabel(
  code: AccreditationPersonnelCategoryCode,
): string {
  return resolveAccreditationPersonnelCategory(code).label;
}
