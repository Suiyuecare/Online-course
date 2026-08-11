import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterLearnerCourseLibrary,
  hasLearnerCourseLibraryFilters,
  learnerCourseNeedsAttention,
  learnerCourseProgress,
  parseLearnerCourseLibraryQuery,
} from "@/application/learner-course-library";
import type { LearnerCenterRow } from "@/application/learner-center";

const now = Date.parse("2026-07-30T04:00:00.000Z");

function row(
  input: Partial<LearnerCenterRow> & {
    enrollment_id: string;
    course_title: string;
  },
): LearnerCenterRow {
  return {
    enrollment_id: input.enrollment_id,
    course_title: input.course_title,
    delivery_type: input.delivery_type ?? "recorded",
    enrollment_status: input.enrollment_status ?? "active",
    confirmed_valid_seconds: input.confirmed_valid_seconds ?? 0,
    required_seconds: input.required_seconds ?? 3_600,
    next_live_starts_at: input.next_live_starts_at ?? null,
    certificate_status: input.certificate_status ?? null,
    certificate_id: input.certificate_id ?? null,
    course_version_id:
      input.course_version_id ?? "22222222-2222-4222-8222-222222222222",
    course_slug: input.course_slug ?? "course",
    completed_at: input.completed_at ?? null,
    has_cover: input.has_cover ?? false,
    completion_due_at: input.completion_due_at ?? null,
    content_available_at: input.content_available_at ?? null,
  };
}

const courses = [
  row({
    enrollment_id: "11111111-1111-4111-8111-111111111111",
    course_title: "失智照護實務",
    confirmed_valid_seconds: 1_800,
    completion_due_at: "2026-08-20T04:00:00.000Z",
  }),
  row({
    enrollment_id: "22222222-2222-4222-8222-222222222222",
    course_title: "感染控制直播班",
    delivery_type: "live",
    next_live_starts_at: "2026-08-01T04:00:00.000Z",
  }),
  row({
    enrollment_id: "33333333-3333-4333-8333-333333333333",
    course_title: "長照倫理",
    enrollment_status: "credited",
    confirmed_valid_seconds: 3_600,
    completed_at: "2026-07-20T04:00:00.000Z",
  }),
  row({
    enrollment_id: "44444444-4444-4444-8444-444444444444",
    course_title: "溝通與申訴處理",
    enrollment_status: "needs_correction",
    delivery_type: "hybrid",
    completion_due_at: "2026-07-29T04:00:00.000Z",
  }),
];

describe("learner course library", () => {
  it("normalizes unsupported query parameters to safe defaults", () => {
    expect(
      parseLearnerCourseLibraryQuery({
        q: ["  失智  ", "ignored"],
        status: "unknown",
        delivery: "external",
        sort: "random",
      }),
    ).toEqual({
      query: "失智",
      status: "all",
      delivery: "all",
      sort: "recommended",
    });
  });

  it("searches titles and combines delivery and status filters", () => {
    expect(
      filterLearnerCourseLibrary(
        courses,
        {
          query: "感染",
          status: "upcoming",
          delivery: "live",
          sort: "recommended",
        },
        now,
      ).map((course) => course.course_title),
    ).toEqual(["感染控制直播班"]);

    expect(
      filterLearnerCourseLibrary(
        courses,
        {
          query: "",
          status: "completed",
          delivery: "all",
          sort: "recommended",
        },
        now,
      ).map((course) => course.course_title),
    ).toEqual(["長照倫理"]);
  });

  it("identifies explicit correction states and overdue active courses", () => {
    expect(learnerCourseNeedsAttention(courses[3], now)).toBe(true);
    expect(
      learnerCourseNeedsAttention(
        row({
          enrollment_id: "55555555-5555-4555-8555-555555555555",
          course_title: "逾期課程",
          completion_due_at: "2026-07-01T04:00:00.000Z",
        }),
        now,
      ),
    ).toBe(true);
    expect(learnerCourseNeedsAttention(courses[2], now)).toBe(false);
  });

  it("sorts predictably while keeping the recommended source order stable", () => {
    const defaultQuery = parseLearnerCourseLibraryQuery({});
    expect(
      filterLearnerCourseLibrary(courses, defaultQuery, now).map(
        (course) => course.course_title,
      ),
    ).toEqual(courses.map((course) => course.course_title));

    expect(
      filterLearnerCourseLibrary(
        courses,
        { ...defaultQuery, sort: "progress" },
        now,
      ).map((course) => course.course_title),
    ).toEqual(["長照倫理", "失智照護實務", "感染控制直播班", "溝通與申訴處理"]);

    expect(
      filterLearnerCourseLibrary(
        courses,
        { ...defaultQuery, sort: "nearest" },
        now,
      ).map((course) => course.course_title),
    ).toEqual(["溝通與申訴處理", "感染控制直播班", "失智照護實務", "長照倫理"]);

    expect(
      filterLearnerCourseLibrary(
        courses,
        { ...defaultQuery, sort: "title" },
        now,
      ).map((course) => course.course_title),
    ).toEqual(
      courses
        .map((course) => course.course_title)
        .toSorted((left, right) => left.localeCompare(right, "zh-Hant")),
    );

    expect(learnerCourseProgress(courses[0])).toBe(50);
    expect(hasLearnerCourseLibraryFilters(defaultQuery)).toBe(false);
    expect(
      hasLearnerCourseLibraryFilters({
        ...defaultQuery,
        delivery: "hybrid",
      }),
    ).toBe(true);
  });

  it("renders accessible controls, an honest no-result state, and fail-closed orders", () => {
    const dashboard = readFileSync(
      resolve(process.cwd(), "src/app/learner/page.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    for (const label of [
      "搜尋我的課程",
      "學習狀態",
      "授課形式",
      "排序方式",
      "套用條件",
      "清除條件",
      "沒有符合這組條件的課程",
    ]) {
      expect(dashboard).toContain(label);
    }
    expect(dashboard).toContain('aria-live="polite"');
    expect(dashboard).toContain("!orderState.available");
    expect(dashboard).toContain("目前無法確認最近訂單");
    expect(styles).toContain(".learner-course-library-controls");
    expect(styles).toContain("min-height: 48px");
  });
});
