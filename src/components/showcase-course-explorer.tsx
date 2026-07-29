"use client";

import { useState } from "react";
import type { ShowcaseCourse } from "@/content/showcase-courses";
import {
  showcaseCategories,
  showcaseCreditTypes,
} from "@/content/showcase-courses";
import { ShowcaseCourseCard } from "@/components/showcase-course-card";

type ShowcaseExplorerFilters = {
  query: string;
  category: (typeof showcaseCategories)[number];
  deliveryType: "all" | ShowcaseCourse["deliveryType"];
  creditType: (typeof showcaseCreditTypes)[number];
};

function normalizeSearchValue(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant-TW");
}

export function filterShowcaseCourses(
  courses: ShowcaseCourse[],
  filters: ShowcaseExplorerFilters,
) {
  const normalizedQuery = normalizeSearchValue(filters.query.trim());
  return courses.filter((course) => {
    const searchableText = [
      course.title,
      course.summary,
      course.category,
      course.creditType,
      course.instructor.displayName,
      course.instructor.role,
      ...course.audience,
      ...course.learningObjectives,
    ].join(" ");
    const matchesQuery =
      !normalizedQuery ||
      normalizeSearchValue(searchableText).includes(normalizedQuery);
    const matchesCategory =
      filters.category === "全部課程" || course.category === filters.category;
    const matchesDelivery =
      filters.deliveryType === "all" ||
      course.deliveryType === filters.deliveryType;
    const matchesCreditType =
      filters.creditType === "全部積分屬性" ||
      course.creditType === filters.creditType;
    return (
      matchesQuery && matchesCategory && matchesDelivery && matchesCreditType
    );
  });
}

export function ShowcaseCourseExplorer({
  courses,
  initialCategory = "全部課程",
  initialQuery = "",
  learnerMode = false,
}: {
  courses: ShowcaseCourse[];
  initialCategory?: (typeof showcaseCategories)[number];
  initialQuery?: string;
  learnerMode?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery.slice(0, 100));
  const [category, setCategory] =
    useState<(typeof showcaseCategories)[number]>(initialCategory);
  const [deliveryType, setDeliveryType] =
    useState<ShowcaseExplorerFilters["deliveryType"]>("all");
  const [creditType, setCreditType] =
    useState<(typeof showcaseCreditTypes)[number]>("全部積分屬性");

  const visibleCourses = filterShowcaseCourses(courses, {
    query,
    category,
    deliveryType,
    creditType,
  });

  return (
    <div className="course-explorer">
      <div className="course-filter-panel" id="course-search">
        <label>
          搜尋課程
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入失智、長照、吞嚥…"
            maxLength={100}
            type="search"
            value={query}
          />
        </label>
        <label>
          積分屬性
          <select
            onChange={(event) =>
              setCreditType(
                event.target.value as (typeof showcaseCreditTypes)[number],
              )
            }
            value={creditType}
          >
            {showcaseCreditTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          課程形式
          <select
            onChange={(event) =>
              setDeliveryType(
                event.target.value as ShowcaseExplorerFilters["deliveryType"],
              )
            }
            value={deliveryType}
          >
            <option value="all">全部形式</option>
            <option value="recorded">錄播</option>
            <option value="live">同步直播</option>
            <option value="hybrid">錄播＋直播</option>
          </select>
        </label>
      </div>
      <div className="category-chips" aria-label="依主題篩選">
        {showcaseCategories.map((item) => (
          <button
            aria-pressed={category === item}
            key={item}
            onClick={() => setCategory(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="course-results-heading"
        role="status"
      >
        <strong>找到 {visibleCourses.length} 門示範課程</strong>
        <span>可查看課綱與公開影片；目前不接受報名或付款</span>
      </div>
      {visibleCourses.length ? (
        <div className="course-grid">
          {visibleCourses.map((course) => (
            <ShowcaseCourseCard
              course={course}
              key={course.slug}
              learnerMode={learnerMode}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>沒有符合條件的課程</h2>
          <p>可以清除關鍵字，或改選其他主題與課程形式。</p>
          <button
            className="button secondary"
            onClick={() => {
              setQuery("");
              setCategory("全部課程");
              setDeliveryType("all");
              setCreditType("全部積分屬性");
            }}
            type="button"
          >
            清除所有篩選
          </button>
        </div>
      )}
    </div>
  );
}
