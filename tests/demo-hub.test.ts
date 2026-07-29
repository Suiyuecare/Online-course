import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public customer demo hub", () => {
  it("offers the three presentation paths without implying real records", () => {
    const page = source("src/app/demo/page.tsx");

    for (const role of ["個人學員", "機構培訓", "平台管理員"]) {
      expect(page).toContain(role);
    }

    expect(page).toContain("操作示範，不產生正式訂單或學習紀錄");
    expect(page).toContain("/courses/demo/dementia-compassionate-care");
    expect(page).toContain('href: "/demo/organization"');
    expect(page).toContain('href: "/demo/staff"');
  });

  it("is noindex and includes accessible landmarks and mobile styling", () => {
    const page = source("src/app/demo/page.tsx");
    const css = source("src/app/demo/demo.module.css");

    expect(page).toContain("index: false");
    expect(page).toContain('aria-labelledby="demo-title"');
    expect(page).toContain('aria-label="示範環境說明"');
    expect(page).toContain('id="demo-agenda"');
    expect(css).toContain("@media (max-width: 680px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
  });

  it("keeps the walkthrough moving from learner to organization to staff", () => {
    const learner = source("src/components/showcase-course-detail.tsx");
    const organization = source(
      "src/app/demo/organization/organization-demo.tsx",
    );
    const staff = source("src/app/demo/staff/staff-demo.tsx");

    expect(learner).toContain('href="/demo/organization"');
    expect(organization).toContain('href="/demo/staff"');
    expect(staff).toContain('href="/demo"');
    expect(staff).not.toContain('href="/demo/organization"');
  });
});
