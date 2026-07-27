import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  showcaseCategories,
  showcaseCourses,
} from "@/content/showcase-courses";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public showcase courses", () => {
  it("ships a varied, internally consistent visual catalog", () => {
    const verifiedEmbeddableVideos = new Set([
      "nL3fz7w42b8",
      "vGoGa-IZNJg",
      "G_3NbxHjhY0",
      "qimRv1gJblQ",
      "siMWhAyQ5Co",
      "uOhzqAkW7SI",
      "A4rVWXvP2j4",
      "Awg6uDbbFvI",
    ]);

    expect(showcaseCourses).toHaveLength(8);
    expect(new Set(showcaseCourses.map((course) => course.slug)).size).toBe(8);
    expect(
      new Set(showcaseCourses.map((course) => course.youtubeId)).size,
    ).toBe(8);
    expect(new Set(showcaseCourses.map((course) => course.category)).size).toBe(
      showcaseCategories.length - 1,
    );
    expect(new Set(showcaseCourses.map((course) => course.youtubeId))).toEqual(
      verifiedEmbeddableVideos,
    );

    for (const course of showcaseCourses) {
      expect(course.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(course.learningObjectives.length).toBeGreaterThanOrEqual(3);
      expect(course.audience.length).toBeGreaterThanOrEqual(3);
      expect(
        course.modules.reduce(
          (count, module) => count + module.lessons.length,
          0,
        ),
      ).toBe(course.lessonCount);
    }
  });

  it("keeps YouTube previews outside formal learning evidence", () => {
    const preview = source("src/components/youtube-demo-preview.tsx");
    const detail = source("src/components/showcase-course-detail.tsx");
    const card = source("src/components/showcase-course-card.tsx");
    const demoRoute = source("src/app/courses/demo/[slug]/page.tsx");
    const formalRoute = source("src/app/courses/[slug]/page.tsx");

    expect(preview).toContain("https://www.youtube-nocookie.com/embed/");
    expect(preview).toContain("不計入觀看分鐘、防掛機、測驗或長照積分");
    expect(preview).toContain("在 YouTube 開啟原始影片（新視窗）");
    expect(preview).not.toMatch(/heartbeat|watch_blocks|learning_events/);
    expect(detail).toContain("網站功能示範");
    expect(detail).toContain("尚未開放報名");
    expect(detail).not.toContain("/contract");
    expect(detail).not.toContain("/checkout");
    expect(card).toContain("/courses/demo/");
    expect(demoRoute).toContain("index: false");
    expect(demoRoute).toContain("follow: false");
    expect(demoRoute).toContain("網站功能示範");
    expect(formalRoute).not.toContain("showcaseCourse");
  });

  it("allows only the exact showcase media hosts", () => {
    const config = source("next.config.ts");
    expect(config).toContain("https://www.youtube-nocookie.com");
    expect(config).toContain('hostname: "i.ytimg.com"');
    expect(config).toContain('hostname: "images.unsplash.com"');
    expect(config).not.toContain("https://*.youtube.com");
  });

  it("carries home topics into an announced catalog filter", () => {
    const home = source("src/app/page.tsx");
    const explorer = source("src/components/showcase-course-explorer.tsx");

    expect(home).toContain("encodeURIComponent(title)");
    expect(explorer).toContain("initialCategory");
    expect(explorer).toContain('aria-live="polite"');
    expect(explorer).toContain('role="status"');
  });
});
