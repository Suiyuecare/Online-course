import Link from "next/link";
import {
  catalogFilterQuery,
  catalogFiltersAreActive,
  filterCatalogCourses,
  type CatalogFilters,
} from "@/application/catalog-filtering";
import { CourseCard } from "@/components/course-card";
import { learnerCourseTaxonomy } from "@/domain/course-taxonomy";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

const resultDescription = {
  approved: "只顯示積分已核定課程",
  applying: "只顯示積分申請中課程",
  all: "顯示所有積分狀態",
} satisfies Record<CatalogFilters["accreditation"], string>;

export function OfficialCourseExplorer({
  courses,
  filters,
}: {
  courses: CatalogCourse[];
  filters: CatalogFilters;
}) {
  const visibleCourses = filterCatalogCourses(courses, filters);
  const filtersActive = catalogFiltersAreActive(filters);
  const resetQuery = catalogFilterQuery({
    query: "",
    delivery: "all",
    accreditation: "all",
    category: "all",
  });
  const resetHref = `/learner/catalog${resetQuery ? `?${resetQuery}` : ""}#official-courses`;

  return (
    <div className="official-course-explorer">
      <form
        action="/learner/catalog#official-courses"
        className="official-course-filter-panel"
        method="get"
        role="search"
      >
        <label>
          搜尋正式課程
          <input
            defaultValue={filters.query}
            maxLength={100}
            name="q"
            placeholder="輸入課程、照護主題或講師"
            type="search"
          />
        </label>
        <label>
          照護主題
          <select defaultValue={filters.category} name="category">
            <option value="all">全部主題</option>
            {learnerCourseTaxonomy.map((category) => (
              <option key={category.code} value={category.code}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          課程形式
          <select defaultValue={filters.delivery} name="delivery">
            <option value="all">全部形式</option>
            <option value="recorded">錄播</option>
            <option value="live">同步直播</option>
            <option value="hybrid">錄播＋直播</option>
          </select>
        </label>
        <label>
          積分狀態
          <select defaultValue={filters.accreditation} name="accreditation">
            <option value="all">全部狀態</option>
            <option value="approved">積分已核定</option>
            <option value="applying">積分申請中</option>
          </select>
        </label>
        <div className="official-course-filter-actions">
          <button className="button" type="submit">
            套用篩選
          </button>
          {filtersActive && <Link href={resetHref}>清除條件</Link>}
        </div>
      </form>

      <div
        aria-atomic="true"
        aria-live="polite"
        className="course-results-heading official-course-results-heading"
        role="status"
      >
        <strong>
          找到 {visibleCourses.length} 門
          {filtersActive ? "符合條件的" : "可報名的"}正式課程
        </strong>
        <span>{resultDescription[filters.accreditation]}</span>
      </div>

      {visibleCourses.length > 0 ? (
        <div className="course-grid">
          {visibleCourses.map((course) => (
            <CourseCard course={course} key={course.slug} learnerMode />
          ))}
        </div>
      ) : (
        <div className="empty-state official-course-empty-state">
          <h3>
            {filtersActive
              ? "目前沒有符合條件的正式課程"
              : "目前沒有開放報名的正式課程"}
          </h3>
          <p>
            {filtersActive
              ? "可以清除條件，或改用其他關鍵字、課程形式與積分狀態。"
              : "正式課程開放後會顯示在這裡；你可以先往下查看課程內容示範。"}
          </p>
          {filtersActive && (
            <Link className="button secondary" href={resetHref}>
              查看全部正式課程
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
