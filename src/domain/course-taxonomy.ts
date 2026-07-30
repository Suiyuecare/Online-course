import { z } from "zod";

export const courseCategoryCodes = [
  "career_foundations",
  "daily_care_skills",
  "complex_care_needs",
  "rehabilitation_home_end_of_life",
  "quality_safety_infection",
  "communication_supervision_management",
  "ethics_rights_cultural_safety",
  "policy_law_workplace_rights",
] as const;

export const courseCategoryCodeSchema = z.enum(courseCategoryCodes);

export type CourseCategoryCode = z.infer<typeof courseCategoryCodeSchema>;

export const learnerCourseTaxonomy = [
  {
    code: "career_foundations",
    title: "入門、資格與職涯進階",
    description: "共同訓練、照服員資格，以及居督、照管與個管進階。",
    shortLabel: "入門進階",
  },
  {
    code: "daily_care_skills",
    title: "日常照護與專業技能",
    description: "營養吞嚥、移位輔具、足部照護、管路與急救技能。",
    shortLabel: "照護技能",
  },
  {
    code: "complex_care_needs",
    title: "失智、身障與特殊需求",
    description: "失智照護、身障支持、精神照護與家庭照顧者支持。",
    shortLabel: "特殊需求",
  },
  {
    code: "rehabilitation_home_end_of_life",
    title: "復能、居家醫療與善終",
    description: "復能、延緩失能、居家醫療、安寧與預立醫療。",
    shortLabel: "復能善終",
  },
  {
    code: "quality_safety_infection",
    title: "品質、安全與感染管制",
    description: "感染、消防、緊急應變、風險管理與職業安全。",
    shortLabel: "品質安全",
  },
  {
    code: "communication_supervision_management",
    title: "溝通、督導與服務管理",
    description: "跨專業溝通、個案管理、人力督導與資源連結。",
    shortLabel: "督導管理",
  },
  {
    code: "ethics_rights_cultural_safety",
    title: "倫理、人權與文化安全",
    description: "尊嚴隱私、性別敏感度、原民與多元文化安全。",
    shortLabel: "倫理人權",
  },
  {
    code: "policy_law_workplace_rights",
    title: "政策法規與職場權益",
    description: "長照法規、個資、消保、勞權與職場安全規範。",
    shortLabel: "政策法規",
  },
] as const satisfies readonly {
  code: CourseCategoryCode;
  title: string;
  description: string;
  shortLabel: string;
}[];

export function courseCategoryByCode(
  code: CourseCategoryCode | "all" | null | undefined,
) {
  if (!code || code === "all") return null;
  return (
    learnerCourseTaxonomy.find((category) => category.code === code) ?? null
  );
}

export function courseCategoryCodeForTitle(title: string) {
  return (
    learnerCourseTaxonomy.find((category) => category.title === title)?.code ??
    null
  );
}
