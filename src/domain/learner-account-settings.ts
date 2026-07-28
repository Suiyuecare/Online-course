import { z } from "zod";

export const learnerGenderOptions = [
  { value: "undisclosed", label: "不透露" },
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "non_binary", label: "非二元性別" },
  { value: "other", label: "其他" },
] as const;

export const learnerCurrentStatusOptions = [
  { value: "care_professional", label: "長照從業人員" },
  { value: "organization_manager", label: "機構管理／培訓人員" },
  { value: "medical_professional", label: "醫事專業人員" },
  { value: "student", label: "相關科系學生" },
  { value: "family_caregiver", label: "家庭照顧者" },
  { value: "other", label: "其他" },
  { value: "undisclosed", label: "暫不提供" },
] as const;

export const learnerLearningGoalOptions = [
  { value: "earn_credits", label: "取得長照積分" },
  { value: "care_skills", label: "提升照護技能" },
  { value: "new_staff_training", label: "完成新人訓練" },
  { value: "career_growth", label: "職涯進階" },
  { value: "regulation_updates", label: "掌握法規新知" },
  { value: "organization_management", label: "機構管理" },
  { value: "personal_growth", label: "自我成長" },
] as const;

export const learnerInterestOptions = [
  { value: "career_entry", label: "入門、資格與職涯進階" },
  { value: "daily_care", label: "日常照護與專業技能" },
  { value: "special_needs", label: "失智、身障與特殊需求" },
  { value: "reablement", label: "復能、居家醫療與善終" },
  { value: "quality_safety", label: "品質、安全與感染管制" },
  { value: "supervision_management", label: "溝通、督導與服務管理" },
  { value: "ethics_rights", label: "倫理、人權與文化安全" },
  { value: "policy_law", label: "政策法規與職場權益" },
] as const;

export const learnerProfessionalRoleCatalog = [
  {
    value: "long_term_care",
    label: "長期照顧",
    titles: [
      { value: "care_worker", label: "照顧服務員" },
      { value: "home_service_supervisor", label: "居家服務督導員" },
      { value: "care_manager", label: "照顧管理專員" },
      { value: "case_manager", label: "個案管理員" },
      { value: "institution_manager", label: "長照機構管理者" },
    ],
  },
  {
    value: "medical_health",
    label: "醫事／健康",
    titles: [
      { value: "nurse", label: "護理師／護士" },
      { value: "physician", label: "醫師" },
      { value: "physical_therapist", label: "物理治療師" },
      { value: "occupational_therapist", label: "職能治療師" },
      { value: "dietitian", label: "營養師" },
      { value: "pharmacist", label: "藥師" },
    ],
  },
  {
    value: "social_work",
    label: "社會工作／社區",
    titles: [
      { value: "social_worker", label: "社會工作師／社工人員" },
      { value: "community_coordinator", label: "社區照顧關懷據點人員" },
    ],
  },
  {
    value: "operations",
    label: "行政／營運",
    titles: [
      { value: "administrator", label: "行政人員" },
      { value: "training_coordinator", label: "教育訓練人員" },
      { value: "quality_manager", label: "品質管理人員" },
    ],
  },
  {
    value: "student_other",
    label: "學生／其他",
    titles: [
      { value: "student", label: "相關科系學生" },
      { value: "family_caregiver", label: "家庭照顧者" },
      { value: "other", label: "其他" },
    ],
  },
] as const;

function values<const T extends readonly { value: string }[]>(options: T) {
  return options.map((option) => option.value) as [
    T[number]["value"],
    ...T[number]["value"][],
  ];
}

export const learnerGenderCodeSchema = z.enum(values(learnerGenderOptions));
export const learnerCurrentStatusCodeSchema = z.enum(
  values(learnerCurrentStatusOptions),
);
export const learnerLearningGoalCodeSchema = z.enum(
  values(learnerLearningGoalOptions),
);
export const learnerInterestCodeSchema = z.enum(values(learnerInterestOptions));
export const learnerProfessionalCategoryCodeSchema = z.enum(
  values(learnerProfessionalRoleCatalog),
);

const professionalTitleCodes = learnerProfessionalRoleCatalog.flatMap(
  (category) => category.titles.map((title) => title.value),
) as [
  (typeof learnerProfessionalRoleCatalog)[number]["titles"][number]["value"],
  ...(typeof learnerProfessionalRoleCatalog)[number]["titles"][number]["value"][],
];

export const learnerProfessionalTitleCodeSchema = z.enum(
  professionalTitleCodes,
);

export type LearnerGenderCode = z.infer<typeof learnerGenderCodeSchema>;
export type LearnerCurrentStatusCode = z.infer<
  typeof learnerCurrentStatusCodeSchema
>;
export type LearnerLearningGoalCode = z.infer<
  typeof learnerLearningGoalCodeSchema
>;
export type LearnerInterestCode = z.infer<typeof learnerInterestCodeSchema>;
export type LearnerProfessionalCategoryCode = z.infer<
  typeof learnerProfessionalCategoryCodeSchema
>;
export type LearnerProfessionalTitleCode = z.infer<
  typeof learnerProfessionalTitleCodeSchema
>;

export function isLearnerProfessionalRolePair(
  category: LearnerProfessionalCategoryCode,
  title: LearnerProfessionalTitleCode,
): boolean {
  return learnerProfessionalRoleCatalog.some(
    (option) =>
      option.value === category &&
      option.titles.some((candidate) => candidate.value === title),
  );
}

export const learnerProfessionalRoleInputSchema = z
  .object({
    category: learnerProfessionalCategoryCodeSchema,
    title: learnerProfessionalTitleCodeSchema,
  })
  .strict()
  .refine(
    ({ category, title }) => isLearnerProfessionalRolePair(category, title),
    { message: "PROFESSIONAL_ROLE_PAIR_INVALID" },
  );

function uniqueCodeArray<T extends z.ZodType>(
  schema: T,
  maximum: number,
  maximumMessage: string,
) {
  return z
    .array(schema)
    .max(maximum, maximumMessage)
    .refine((items) => new Set(items).size === items.length, {
      message: "DUPLICATE_CODE_REJECTED",
    });
}

const birthDateSchema = z.iso.date().refine(
  (value) => {
    const today = new Date();
    const todayIso = [
      today.getUTCFullYear().toString().padStart(4, "0"),
      (today.getUTCMonth() + 1).toString().padStart(2, "0"),
      today.getUTCDate().toString().padStart(2, "0"),
    ].join("-");
    return value >= "1900-01-01" && value <= todayIso;
  },
  { message: "BIRTH_DATE_OUT_OF_RANGE" },
);

export const learnerAccountSettingsInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().safe(),
    gender: learnerGenderCodeSchema.optional(),
    birthDate: birthDateSchema.nullable().optional(),
    currentStatus: learnerCurrentStatusCodeSchema,
    professionalRoles: z
      .array(learnerProfessionalRoleInputSchema)
      .max(5, "TOO_MANY_PROFESSIONAL_ROLES")
      .refine(
        (roles) =>
          new Set(roles.map((role) => `${role.category}:${role.title}`))
            .size === roles.length,
        { message: "DUPLICATE_PROFESSIONAL_ROLE_REJECTED" },
      ),
    learningGoals: uniqueCodeArray(
      learnerLearningGoalCodeSchema,
      3,
      "TOO_MANY_LEARNING_GOALS",
    ),
    interests: uniqueCodeArray(
      learnerInterestCodeSchema,
      8,
      "TOO_MANY_INTERESTS",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.gender === undefined) !== (value.birthDate === undefined)) {
      context.addIssue({
        code: "custom",
        message: "SENSITIVE_PROFILE_FIELDS_INCOMPLETE",
        path: ["gender"],
      });
    }
  });

export const learnerAccountSensitiveProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    gender: learnerGenderCodeSchema,
    birthDate: birthDateSchema.nullable(),
  })
  .strict();

export type LearnerAccountSettingsInput = z.infer<
  typeof learnerAccountSettingsInputSchema
>;
