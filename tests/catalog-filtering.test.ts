import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  catalogFilterQuery,
  catalogFiltersAreActive,
  filterCatalogCourses,
  parseCatalogFilters,
} from "@/application/catalog-filtering";
import type {
  CatalogCourse,
  InternalCatalogCourse,
} from "@/infrastructure/supabase/catalog";

function course(
  overrides: Partial<InternalCatalogCourse> &
    Pick<InternalCatalogCourse, "slug" | "title">,
): InternalCatalogCourse {
  const { slug, title, ...remainingOverrides } = overrides;
  return {
    slug,
    course_version_id: crypto.randomUUID(),
    title,
    summary: "長照專業課程",
    description: "提供第一線照護工作者可實作的方法。",
    learning_objectives: ["完成情境演練"],
    category_code: "complex_care_needs",
    category_title: "失智、身障與特殊需求",
    delivery_type: "recorded",
    price_twd: 680,
    recorded_refund_allocation_twd: 680,
    live_refund_allocations: [],
    organization_point_price: null,
    accreditation_status: "approved",
    accreditation_points: 2,
    has_cover: false,
    equipment_requirements: "",
    instructors: [
      {
        name: "王老師",
        biography: "長照教育講師",
        credentials: "護理師",
      },
    ],
    first_live_starts_at: null,
    legal_document_id: crypto.randomUUID(),
    legal_document_sha256: "a".repeat(64),
    live_sessions: [],
    registration_mode: "internal",
    external_registration_url: null,
    registration_cta_label: "報名活動",
    ...remainingOverrides,
  };
}

const courses = [
  course({
    slug: "dementia-care",
    title: "失智症安心照護",
    learning_objectives: ["辨識行為背後的需求"],
  }),
  course({
    slug: "infection-live",
    title: "感染管制直播實務",
    delivery_type: "live",
    category_code: "quality_safety_infection",
    category_title: "品質、安全與感染管制",
    accreditation_status: "applying",
    accreditation_points: null,
    recorded_refund_allocation_twd: 0,
    live_refund_allocations: [
      {
        componentId: crypto.randomUUID(),
        title: "感染管制直播實務",
        amountTwd: 680,
      },
    ],
    instructors: [
      {
        name: "陳老師",
        biography: "感染管制教學",
        credentials: "感染管制護理師",
      },
    ],
  }),
] satisfies CatalogCourse[];

describe("official course catalog filters", () => {
  it("parses shareable query parameters and rejects unsupported values", () => {
    expect(
      parseCatalogFilters({
        q: " 失智 ",
        delivery: "recorded",
        accreditation: "approved",
        category: "complex_care_needs",
      }),
    ).toEqual({
      query: "失智",
      delivery: "recorded",
      accreditation: "approved",
      category: "complex_care_needs",
    });

    expect(
      parseCatalogFilters({
        q: ["第一個", "第二個"],
        delivery: "video",
        accreditation: "credited",
        category: "自由輸入分類",
      }),
    ).toEqual({
      query: "第一個",
      delivery: "all",
      accreditation: "all",
      category: "all",
    });
  });

  it("combines keyword, delivery and accreditation status filters", () => {
    expect(
      filterCatalogCourses(courses, {
        query: "行為",
        delivery: "recorded",
        accreditation: "approved",
        category: "complex_care_needs",
      }).map(({ slug }) => slug),
    ).toEqual(["dementia-care"]);

    expect(
      filterCatalogCourses(courses, {
        query: "感染管制護理師",
        delivery: "live",
        accreditation: "applying",
        category: "quality_safety_infection",
      }).map(({ slug }) => slug),
    ).toEqual(["infection-live"]);

    expect(
      filterCatalogCourses(courses, {
        query: "不存在",
        delivery: "all",
        accreditation: "all",
        category: "all",
      }),
    ).toEqual([]);
  });

  it("matches normalized search text and builds minimal stable URLs", () => {
    expect(
      filterCatalogCourses(courses, {
        query: "失智症安心照護",
        delivery: "all",
        accreditation: "all",
        category: "all",
      }),
    ).toHaveLength(1);

    const filters = {
      query: "失智",
      delivery: "recorded",
      accreditation: "approved",
      category: "complex_care_needs",
    } as const;
    expect(catalogFiltersAreActive(filters)).toBe(true);
    expect(catalogFilterQuery(filters)).toBe(
      "q=%E5%A4%B1%E6%99%BA&delivery=recorded&accreditation=approved&category=complex_care_needs",
    );
    expect(
      catalogFilterQuery({
        query: "",
        delivery: "all",
        accreditation: "all",
        category: "all",
      }),
    ).toBe("");
  });

  it("uses a native GET form so filters survive reload, sharing and Back", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/learner/catalog/page.tsx"),
      "utf8",
    );
    const explorer = readFileSync(
      resolve(process.cwd(), "src/components/official-course-explorer.tsx"),
      "utf8",
    );

    expect(page).toContain("parseCatalogFilters(resolvedSearchParams)");
    expect(page).toContain('id="official-courses"');
    expect(explorer).toContain('method="get"');
    expect(explorer).toContain('name="q"');
    expect(explorer).toContain('name="delivery"');
    expect(explorer).toContain('name="accreditation"');
    expect(explorer).toContain('name="category"');
    expect(explorer).not.toContain("useSearchParams");
  });
});
