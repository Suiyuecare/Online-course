import { describe, expect, it } from "vitest";
import {
  rankCatalogRecommendations,
  type CatalogRecommendationPreferences,
} from "@/application/catalog-recommendations";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

function course(
  slug: string,
  categoryCode: CatalogCourse["category_code"],
  overrides: Partial<CatalogCourse> = {},
): CatalogCourse {
  return {
    slug,
    course_version_id: crypto.randomUUID(),
    title: slug,
    summary: "正式課程",
    description: "正式發布的長照課程",
    learning_objectives: ["完成學習"],
    category_code: categoryCode,
    category_title: "長照課程",
    delivery_type: "recorded",
    price_twd: 800,
    recorded_refund_allocation_twd: 800,
    live_refund_allocations: [],
    organization_point_price: null,
    accreditation_status: "approved",
    accreditation_points: 2,
    has_cover: false,
    equipment_requirements: "",
    instructors: [],
    first_live_starts_at: null,
    legal_document_id: crypto.randomUUID(),
    legal_document_sha256: "a".repeat(64),
    live_sessions: [],
    registration_mode: "internal",
    external_registration_url: null,
    registration_cta_label: "報名活動",
    purchase_readiness: {
      purchaseReady: true,
      reasons: [],
    },
    ...overrides,
  };
}

const preferences = {
  currentStatus: "care_professional",
  interests: ["daily_care", "special_needs"],
  learningGoals: ["care_skills", "earn_credits"],
} satisfies CatalogRecommendationPreferences;

describe("formal catalog recommendations", () => {
  it("ranks exact learner interests ahead of generic catalog ordering", () => {
    const courses = [
      course("policy", "policy_law_workplace_rights"),
      course("special", "complex_care_needs"),
      course("daily", "daily_care_skills"),
    ];

    expect(
      rankCatalogRecommendations(courses, preferences).map(
        (candidate) => candidate.slug,
      ),
    ).toEqual(["daily", "special", "policy"]);
    expect(courses.map((candidate) => candidate.slug)).toEqual([
      "policy",
      "special",
      "daily",
    ]);
  });

  it("excludes owned versions and slugs before ranking", () => {
    const ownedByVersion = course("owned-version", "daily_care_skills");
    const ownedBySlug = course("owned-slug", "complex_care_needs");
    const available = course("available", "career_foundations");

    expect(
      rankCatalogRecommendations(
        [ownedByVersion, ownedBySlug, available],
        preferences,
        {
          courseVersionIds: [ownedByVersion.course_version_id],
          slugs: [ownedBySlug.slug],
        },
      ).map((candidate) => candidate.slug),
    ).toEqual(["available"]);
  });
});
