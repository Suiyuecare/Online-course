import type {
  LearnerCurrentStatusCode,
  LearnerInterestCode,
  LearnerLearningGoalCode,
} from "@/domain/learner-account-settings";
import type { CourseCategoryCode } from "@/domain/course-taxonomy";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

export type CatalogRecommendationPreferences = {
  currentStatus: LearnerCurrentStatusCode;
  interests: LearnerInterestCode[];
  learningGoals: LearnerLearningGoalCode[];
};

export type CatalogRecommendationExclusions = {
  courseVersionIds?: readonly string[];
  slugs?: readonly string[];
};

const interestCategory = {
  career_entry: "career_foundations",
  daily_care: "daily_care_skills",
  special_needs: "complex_care_needs",
  reablement: "rehabilitation_home_end_of_life",
  quality_safety: "quality_safety_infection",
  supervision_management: "communication_supervision_management",
  ethics_rights: "ethics_rights_cultural_safety",
  policy_law: "policy_law_workplace_rights",
} satisfies Record<LearnerInterestCode, CourseCategoryCode>;

const learningGoalCategories: Record<
  LearnerLearningGoalCode,
  readonly CourseCategoryCode[]
> = {
  earn_credits: [],
  care_skills: ["daily_care_skills", "complex_care_needs"],
  new_staff_training: ["career_foundations", "quality_safety_infection"],
  career_growth: ["career_foundations", "communication_supervision_management"],
  regulation_updates: ["policy_law_workplace_rights"],
  organization_management: [
    "communication_supervision_management",
    "quality_safety_infection",
  ],
  personal_growth: [
    "ethics_rights_cultural_safety",
    "communication_supervision_management",
  ],
};

const currentStatusCategories: Record<
  LearnerCurrentStatusCode,
  readonly CourseCategoryCode[]
> = {
  care_professional: ["daily_care_skills", "complex_care_needs"],
  organization_manager: [
    "communication_supervision_management",
    "quality_safety_infection",
    "policy_law_workplace_rights",
  ],
  medical_professional: [
    "rehabilitation_home_end_of_life",
    "quality_safety_infection",
  ],
  student: ["career_foundations"],
  family_caregiver: ["daily_care_skills", "complex_care_needs"],
  other: [],
  undisclosed: [],
};

function recommendationScore(
  course: CatalogCourse,
  preferences: CatalogRecommendationPreferences,
) {
  let score = 0;

  preferences.interests.forEach((interest, index) => {
    if (interestCategory[interest] === course.category_code) {
      score += Math.max(80, 160 - index * 12);
    }
  });

  preferences.learningGoals.forEach((goal, index) => {
    if (learningGoalCategories[goal].includes(course.category_code)) {
      score += Math.max(24, 54 - index * 8);
    }
    if (goal === "earn_credits" && course.accreditation_status === "approved") {
      score += 28;
    }
  });

  const statusCategoryIndex = currentStatusCategories[
    preferences.currentStatus
  ].indexOf(course.category_code);
  if (statusCategoryIndex >= 0) {
    score += Math.max(12, 30 - statusCategoryIndex * 7);
  }

  if (course.purchase_readiness?.purchaseReady) score += 8;
  if (course.accreditation_status === "approved") score += 5;

  return score;
}

export function rankCatalogRecommendations(
  courses: readonly CatalogCourse[],
  preferences: CatalogRecommendationPreferences,
  exclusions: CatalogRecommendationExclusions = {},
) {
  const excludedCourseVersionIds = new Set(exclusions.courseVersionIds ?? []);
  const excludedSlugs = new Set(exclusions.slugs ?? []);

  return courses
    .filter(
      (course) =>
        !excludedCourseVersionIds.has(course.course_version_id) &&
        !excludedSlugs.has(course.slug),
    )
    .map((course) => ({
      course,
      score: recommendationScore(course, preferences),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;

      const leftStart = left.course.first_live_starts_at
        ? Date.parse(left.course.first_live_starts_at)
        : Number.POSITIVE_INFINITY;
      const rightStart = right.course.first_live_starts_at
        ? Date.parse(right.course.first_live_starts_at)
        : Number.POSITIVE_INFINITY;
      if (leftStart !== rightStart) return leftStart - rightStart;

      return left.course.title.localeCompare(right.course.title, "zh-TW");
    })
    .map(({ course }) => course);
}
