import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  courseCategoryByCode,
  courseCategoryCodeForTitle,
  courseCategoryCodeSchema,
  learnerCourseTaxonomy,
} from "@/domain/course-taxonomy";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("formal course taxonomy", () => {
  it("defines eight stable, unique codes and learner-facing labels", () => {
    expect(learnerCourseTaxonomy).toHaveLength(8);
    expect(
      new Set(learnerCourseTaxonomy.map((category) => category.code)).size,
    ).toBe(8);
    expect(
      new Set(learnerCourseTaxonomy.map((category) => category.title)).size,
    ).toBe(8);
    for (const category of learnerCourseTaxonomy) {
      expect(courseCategoryCodeSchema.parse(category.code)).toBe(category.code);
      expect(category.title.length).toBeGreaterThan(5);
      expect(category.description.length).toBeGreaterThan(15);
    }
  });

  it("maps formal codes to labels without accepting arbitrary strings", () => {
    const category = courseCategoryByCode("complex_care_needs");
    expect(category?.title).toBe("失智、身障與特殊需求");
    expect(courseCategoryCodeForTitle(category?.title ?? "")).toBe(
      "complex_care_needs",
    );
    expect(courseCategoryCodeSchema.safeParse("隨便輸入分類").success).toBe(
      false,
    );
    expect(courseCategoryByCode("all")).toBeNull();
  });

  it("uses the controlled code in staff authoring and formal catalog reads", () => {
    const draftRoute = source("src/app/api/staff/courses/drafts/route.ts");
    const structureRoute = source(
      "src/app/api/staff/courses/[courseVersionId]/structure/route.ts",
    );
    const editor = source("src/components/course-editor.tsx");
    const metadataEditor = source(
      "src/components/course-draft-metadata-editor.tsx",
    );
    const catalog = source("src/infrastructure/supabase/catalog.ts");
    const filter = source("src/application/catalog-filtering.ts");

    expect(draftRoute).toContain("categoryCode: courseCategoryCodeSchema");
    expect(structureRoute).toContain("categoryCode: courseCategoryCodeSchema");
    expect(editor).toContain('name="categoryCode"');
    expect(metadataEditor).toContain('name="categoryCode"');
    expect(catalog).toContain("category_code,category_title");
    expect(filter).toContain("course.category_code !== filters.category");
  });
});
