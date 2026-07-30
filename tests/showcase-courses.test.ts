import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  showcaseCategories,
  showcaseCourses,
} from "@/content/showcase-courses";
import { filterShowcaseCourses } from "@/components/showcase-course-explorer";

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
    expect(
      new Set(showcaseCourses.map((course) => course.coverImage)).size,
    ).toBe(8);

    for (const course of showcaseCourses) {
      expect(course.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(course.coverImage).toMatch(
        /^\/images\/suiyue-original\/course-[a-z-]+\.jpg$/,
      );
      expect(
        existsSync(
          resolve(process.cwd(), "public", course.coverImage.slice(1)),
        ),
      ).toBe(true);
      expect(course.coverAlt.length).toBeGreaterThan(12);
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

  it("keeps self-hosted previews outside formal learning evidence", () => {
    const preview = source("src/components/local-course-demo-preview.tsx");
    const detail = source("src/components/showcase-course-detail.tsx");
    const card = source("src/components/showcase-course-card.tsx");
    const demoRoute = source("src/app/courses/demo/[slug]/page.tsx");
    const formalRoute = source("src/app/courses/[slug]/page.tsx");

    expect(preview).toContain("本站展示不需要載入 YouTube 或其他影音服務");
    expect(preview).toContain("不計入觀看分鐘、防掛機、測驗或長照積分");
    expect(preview).toContain("延伸參考");
    expect(preview).not.toContain("<iframe");
    expect(preview).not.toContain("youtube-nocookie.com/embed");
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

  it("keeps showcase imagery self-hosted and stock-library free", () => {
    const config = source("next.config.ts");
    const home = source("src/app/page.tsx");
    const card = source("src/components/showcase-course-card.tsx");
    const preview = source("src/components/local-course-demo-preview.tsx");
    const heroPath = resolve(
      process.cwd(),
      "public/images/suiyue-original/home-hero-learning-wide-v2.jpg",
    );

    expect(config).not.toContain("https://www.youtube-nocookie.com");
    expect(config).not.toContain("i.ytimg.com");
    expect(config).not.toContain("images.unsplash.com");
    expect(home).not.toMatch(/unsplash|pexels|pixabay/i);
    expect(home).toContain("home-hero-learning-wide-v2.jpg");
    expect(existsSync(heroPath)).toBe(true);
    expect(card).toContain("course.coverImage");
    expect(preview).toContain("posterImage");
    expect(preview).toContain("/images/suiyue-original/");
    expect(config).not.toContain("https://*.youtube.com");
  });

  it("carries home topics into an announced catalog filter", () => {
    const home = source("src/app/page.tsx");
    const explorer = source("src/components/showcase-course-explorer.tsx");

    expect(home).toContain("category=${category.code}");
    expect(explorer).toContain("initialCategory");
    expect(explorer).toContain('aria-live="polite"');
    expect(explorer).toContain('role="status"');
  });

  it("carries public header GET searches into the catalog results", () => {
    const header = source("src/components/site-header.tsx");
    const catalog = source("src/app/courses/page.tsx");

    expect(header).toContain("learnerCourseTaxonomy");
    expect(header).toContain('<details className="site-explore-menu">');
    expect(header).toContain('action="/courses"');
    expect(header).toContain('method="get"');
    expect(header).toContain('name="q"');
    expect(catalog).toContain("parseCatalogFilters(resolvedSearchParams)");
    expect(catalog).toContain("initialQuery={initialQuery}");

    const results = filterShowcaseCourses(showcaseCourses, {
      query: "吞嚥",
      category: "全部課程",
      deliveryType: "all",
      creditType: "全部積分屬性",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain("吞嚥");
  });
});
