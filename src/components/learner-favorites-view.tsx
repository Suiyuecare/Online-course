"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CourseCard } from "@/components/course-card";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ShowcaseCourseCard } from "@/components/showcase-course-card";
import { useLearnerPortal } from "@/components/learner-portal-store";
import type { ShowcaseCourse } from "@/content/showcase-courses";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

type DeliveryFilter = "all" | CatalogCourse["delivery_type"];
type FavoriteSort = "recent" | "upcoming" | "title";

const deliveryOptions: {
  label: string;
  value: DeliveryFilter;
}[] = [
  { label: "全部", value: "all" },
  { label: "錄播", value: "recorded" },
  { label: "同步直播", value: "live" },
  { label: "錄播＋直播", value: "hybrid" },
];

export function LearnerFavoritesView({
  catalogAvailable,
  completedCount,
  courses,
  favoriteCreatedAt,
  favoritesAvailable,
  recommendations,
}: {
  catalogAvailable: boolean;
  completedCount: number;
  courses: CatalogCourse[];
  favoriteCreatedAt: Record<string, string>;
  favoritesAvailable: boolean;
  recommendations: ShowcaseCourse[];
}) {
  const { favoriteSlugs } = useLearnerPortal();
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [sort, setSort] = useState<FavoriteSort>("recent");
  const favoriteSlugSet = useMemo(
    () => new Set(favoriteSlugs),
    [favoriteSlugs],
  );

  const favorites = useMemo(() => {
    const selected = courses.filter((course) =>
      favoriteSlugSet.has(course.slug),
    );
    return selected.sort((left, right) => {
      if (sort === "title")
        return left.title.localeCompare(right.title, "zh-TW");
      if (sort === "upcoming") {
        const leftStart = left.first_live_starts_at
          ? Date.parse(left.first_live_starts_at)
          : Number.POSITIVE_INFINITY;
        const rightStart = right.first_live_starts_at
          ? Date.parse(right.first_live_starts_at)
          : Number.POSITIVE_INFINITY;
        return leftStart - rightStart || left.title.localeCompare(right.title);
      }
      return (
        Date.parse(favoriteCreatedAt[right.slug] ?? "1970-01-01") -
          Date.parse(favoriteCreatedAt[left.slug] ?? "1970-01-01") ||
        left.title.localeCompare(right.title, "zh-TW")
      );
    });
  }, [courses, favoriteCreatedAt, favoriteSlugSet, sort]);

  const visibleFavorites =
    deliveryFilter === "all"
      ? favorites
      : favorites.filter((course) => course.delivery_type === deliveryFilter);

  return (
    <div className="learner-favorites-page">
      <section className="learner-favorites-hero">
        <div className="learner-portal-shell-width">
          <div className="learner-favorites-title">
            <span aria-hidden="true">
              <LearnerPortalIcon name="bookmark" size={32} />
            </span>
            <div>
              <p className="learner-kicker">我的收藏</p>
              <h1>先收好，想上課時再回來比較</h1>
              <p>
                收藏不等於購買；完成付款並取得權限後，課程才會出現在我的課程。
              </p>
            </div>
          </div>
          <dl className="learner-favorites-stats">
            <div>
              <dt>目前收藏</dt>
              <dd>{favorites.length}</dd>
            </div>
            <div>
              <dt>已完成課程</dt>
              <dd>{completedCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="learner-portal-shell-width learner-favorites-content">
        <nav aria-label="我的學習分類" className="learner-library-tabs">
          <Link href="/learner">
            <LearnerPortalIcon name="book" size={20} />
            我的學習
          </Link>
          <Link aria-current="page" href="/learner/favorites">
            <LearnerPortalIcon name="bookmark" size={20} />
            我的收藏
          </Link>
          <Link href="/learner/certificates">
            <LearnerPortalIcon name="certificate" size={20} />
            結訓證明
          </Link>
        </nav>

        {!favoritesAvailable ? (
          <div className="learner-favorites-unavailable" role="alert">
            <span aria-hidden="true">
              <LearnerPortalIcon name="bookmark" size={28} />
            </span>
            <div>
              <strong>暫時無法讀取你的收藏</strong>
              <p>
                這不是「沒有收藏」；資料服務恢復後請重新整理，原有收藏不會因此被刪除。
              </p>
            </div>
          </div>
        ) : !catalogAvailable ? (
          <div className="learner-favorites-unavailable" role="alert">
            <span aria-hidden="true">
              <LearnerPortalIcon name="book" size={28} />
            </span>
            <div>
              <strong>課程資料暫時無法載入</strong>
              <p>你的收藏仍然保留，課程服務恢復後會重新顯示。</p>
            </div>
          </div>
        ) : favorites.length > 0 ? (
          <>
            <section
              aria-label="收藏篩選與排序"
              className="learner-favorites-toolbar"
            >
              <div className="learner-favorites-filters">
                {deliveryOptions.map((option) => {
                  const count =
                    option.value === "all"
                      ? favorites.length
                      : favorites.filter(
                          (course) => course.delivery_type === option.value,
                        ).length;
                  return (
                    <button
                      aria-pressed={deliveryFilter === option.value}
                      key={option.value}
                      onClick={() => setDeliveryFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                      <span>{count}</span>
                    </button>
                  );
                })}
              </div>
              <label>
                排序
                <select
                  onChange={(event) =>
                    setSort(event.target.value as FavoriteSort)
                  }
                  value={sort}
                >
                  <option value="recent">最近收藏</option>
                  <option value="upcoming">即將開課</option>
                  <option value="title">課程名稱</option>
                </select>
              </label>
            </section>

            {visibleFavorites.length > 0 ? (
              <div className="course-grid learner-favorites-grid">
                {visibleFavorites.map((course) => (
                  <CourseCard course={course} key={course.slug} learnerMode />
                ))}
              </div>
            ) : (
              <div className="learner-favorites-filter-empty">
                <strong>這個上課形式目前沒有收藏</strong>
                <p>切回「全部」就能看到其他已收藏課程。</p>
                <button
                  className="button secondary"
                  onClick={() => setDeliveryFilter("all")}
                  type="button"
                >
                  查看全部收藏
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <section className="learner-favorites-empty">
              <div
                aria-hidden="true"
                className="learner-favorites-illustration"
              >
                <span>
                  <LearnerPortalIcon name="bookmark" size={46} />
                </span>
                <i />
                <b />
              </div>
              <p className="learner-kicker">你的靈感書籤</p>
              <h2>還沒有收藏任何課程</h2>
              <p>到課程總覽按下「收藏」，之後換手機登入也能從這裡快速找到。</p>
              <Link className="button" href="/learner/catalog">
                探索全部課程
              </Link>
            </section>

            <section
              aria-labelledby="favorite-recommendations-title"
              className="learner-favorites-recommendations"
            >
              <div className="learner-section-heading">
                <div>
                  <p className="learner-kicker">不知道先看哪一門？</p>
                  <h2 id="favorite-recommendations-title">
                    先看看這些課程內容示範
                  </h2>
                </div>
                <Link href="/learner/catalog">查看完整課程總覽</Link>
              </div>
              <div className="course-grid">
                {recommendations.map((course) => (
                  <ShowcaseCourseCard course={course} key={course.slug} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
