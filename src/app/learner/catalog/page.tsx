import type { Metadata } from "next";
import Link from "next/link";
import {
  catalogFilterQuery,
  parseCatalogFilters,
  type CatalogSearchParams,
} from "@/application/catalog-filtering";
import { OfficialCourseExplorer } from "@/components/official-course-explorer";
import { ShowcaseCourseExplorer } from "@/components/showcase-course-explorer";
import {
  learnerCourseTaxonomy,
  showcaseCourses,
} from "@/content/showcase-courses";
import { courseCategoryByCode } from "@/domain/course-taxonomy";
import { catalogCourseListing } from "@/infrastructure/supabase/catalog";

export const metadata: Metadata = { title: "課程總覽" };

export default async function LearnerCatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const filters = parseCatalogFilters(resolvedSearchParams);
  const initialCategory =
    courseCategoryByCode(filters.category)?.title ?? "全部課程";
  const catalog = await catalogCourseListing();

  return (
    <div className="learner-catalog-page">
      <section className="learner-catalog-hero">
        <div className="learner-portal-shell-width">
          <div>
            <p className="learner-kicker">課程總覽</p>
            <h1>找到現在最需要的照護課</h1>
            <p>
              先依照護主題探索，再用積分屬性與上課形式縮小範圍。正式積分仍以每門課的核定資料為準。
            </p>
          </div>
          <div className="learner-catalog-hero-card">
            <strong>選課前先看三件事</strong>
            <ol>
              <li>是否適用你的長照職類</li>
              <li>積分狀態是否已正式核定</li>
              <li>直播日期與完課條件是否合適</li>
            </ol>
          </div>
        </div>
      </section>

      <div className="learner-portal-shell-width learner-catalog-content">
        <section aria-labelledby="taxonomy-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">依照護需求探索</p>
              <h2 id="taxonomy-title">8 大長照課程主題</h2>
            </div>
            <span>依衛福部訓練資源與現行課程綱要整理</span>
          </div>
          <div className="learner-taxonomy-grid">
            {learnerCourseTaxonomy.map((category, index) => {
              const query = catalogFilterQuery(filters, category.code);
              return (
                <Link
                  href={`/learner/catalog?${query}#course-search`}
                  key={category.title}
                >
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong>{category.title}</strong>
                  <p>{category.description}</p>
                </Link>
              );
            })}
          </div>
        </section>

        {catalog.status === "unavailable" && (
          <div className="learner-inline-notice" role="alert">
            <strong>正式課程暫時無法載入</strong>
            <span>資料服務恢復後會自動顯示；你仍可先查看下方內容示範。</span>
          </div>
        )}

        {catalog.status === "ready" && (
          <section className="learner-official-courses" id="official-courses">
            <div className="learner-section-heading">
              <div>
                <p className="learner-kicker">正式開放</p>
                <h2>現在可報名的課程</h2>
              </div>
              <span>{catalog.courses.length} 門</span>
            </div>
            <OfficialCourseExplorer
              courses={catalog.courses}
              filters={filters}
            />
          </section>
        )}

        <section className="learner-showcase-catalog">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">課程內容預覽</p>
              <h2>先看看歲悅會怎麼教</h2>
            </div>
            <span>展示課不代表已核定或已開放購買</span>
          </div>
          <ShowcaseCourseExplorer
            courses={showcaseCourses}
            initialCategory={initialCategory}
            key={initialCategory}
            learnerMode
          />
        </section>

        <aside className="learner-regulation-note">
          <strong>積分標示原則</strong>
          <p>
            「主題分類」是為了方便找課，不等於積分認可。只有該梯次具備有效核定資料時，課卡才會標示可採認積分。
          </p>
        </aside>
      </div>
    </div>
  );
}
