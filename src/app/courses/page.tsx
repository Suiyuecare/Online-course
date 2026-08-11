import type { Metadata } from "next";
import Image from "next/image";
import {
  filterCatalogCourses,
  parseCatalogFilters,
} from "@/application/catalog-filtering";
import { CourseCard } from "@/components/course-card";
import { ShowcaseCourseExplorer } from "@/components/showcase-course-explorer";
import { showcaseCourses } from "@/content/showcase-courses";
import { courseCategoryByCode } from "@/domain/course-taxonomy";
import { catalogCourseListing } from "@/infrastructure/supabase/catalog";

export const metadata: Metadata = { title: "找課程" };

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string | string[];
    q?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const filters = parseCatalogFilters(resolvedSearchParams);
  const initialQuery = filters.query;
  const initialCategory =
    courseCategoryByCode(filters.category)?.title ?? "全部課程";
  const catalog = await catalogCourseListing();
  const courses = filterCatalogCourses(catalog.courses, filters);
  const selectedCategory = courseCategoryByCode(filters.category);
  return (
    <>
      <section className="course-catalog-hero">
        <Image
          alt="照顧服務員陪伴長者進行認知活動"
          className="course-catalog-hero-image"
          fill
          loading="eager"
          priority
          sizes="100vw"
          src="/images/suiyue-original/home-hero-care-activity.jpg"
        />
        <div aria-hidden="true" className="course-catalog-hero-scrim" />
        <div className="shell">
          <p className="eyebrow">SUIYUECARE COURSE CATALOG</p>
          <h1>今天想學哪一堂？</h1>
          <p>
            從每天真的會遇到的照護情境開始，依主題與課程形式找到適合你的長照進修課。
          </p>
          <div className="catalog-hero-facts">
            <span>錄播：自己安排時間</span>
            <span>直播：網站內直接加入</span>
            <span>混合：觀念與實作一起完成</span>
          </div>
        </div>
      </section>
      <section className="page-shell shell course-catalog-page">
        {catalog.status === "unavailable" && (
          <div className="warning-panel catalog-unavailable" role="alert">
            <strong>正式課程目前暫時無法載入</strong>
            <p>請稍後重新整理；下方仍可查看網站功能與公開影片示範。</p>
          </div>
        )}
        {catalog.courses.length > 0 && (
          <div className="official-course-list">
            <div className="section-heading horizontal">
              <div>
                <p className="eyebrow">正式開放課程</p>
                <h2>
                  {initialQuery
                    ? `「${initialQuery}」的正式課程`
                    : selectedCategory
                      ? selectedCategory.title
                      : "已完成發布與販售檢查"}
                </h2>
              </div>
              <span>
                {courses.length} 門{initialQuery ? "符合搜尋" : "可報名"}
              </span>
            </div>
            {courses.length > 0 ? (
              <div className="course-grid">
                {courses.map((course) => (
                  <CourseCard course={course} key={course.slug} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>正式課程目前沒有符合這個關鍵字</h3>
                <p>你仍可查看下方內容示範，或清除關鍵字重新搜尋。</p>
              </div>
            )}
          </div>
        )}
        <div
          className="section-heading showcase-catalog-heading"
          id="course-showcase"
        >
          <p className="eyebrow">網站功能示範</p>
          <h2>課程主題與影片預覽</h2>
          <p>
            這些內容用來展示完整網站體驗，不是已核定或已開放購買的正式課程。
          </p>
        </div>
        <ShowcaseCourseExplorer
          courses={showcaseCourses}
          initialCategory={initialCategory}
          initialQuery={initialQuery}
          key={`${initialCategory}:${initialQuery}`}
        />
      </section>
    </>
  );
}
