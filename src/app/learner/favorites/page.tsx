"use client";

import Link from "next/link";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ShowcaseCourseCard } from "@/components/showcase-course-card";
import { useLearnerPortal } from "@/components/learner-portal-store";
import { showcaseCourses } from "@/content/showcase-courses";

export default function LearnerFavoritesPage() {
  const { favoriteSlugs, hydrated } = useLearnerPortal();
  const favorites = showcaseCourses.filter((course) =>
    favoriteSlugs.includes(course.slug),
  );

  return (
    <section className="learner-portal-page learner-portal-shell-width">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">我的收藏</p>
          <h1>稍後想看的課程</h1>
          <p>收藏是找課清單，不代表已購買或取得上課權限。</p>
        </div>
      </header>
      {!hydrated ? (
        <div className="learner-loading-card">正在讀取收藏…</div>
      ) : favorites.length > 0 ? (
        <div className="course-grid">
          {favorites.map((course) => (
            <ShowcaseCourseCard course={course} key={course.slug} learnerMode />
          ))}
        </div>
      ) : (
        <div className="learner-friendly-empty">
          <span aria-hidden="true">
            <LearnerPortalIcon name="bookmark" size={40} />
          </span>
          <h2>還沒有收藏課程</h2>
          <p>在課程總覽按下「收藏」，之後就能從這裡快速找到。</p>
          <Link className="button" href="/learner/catalog">
            去探索課程
          </Link>
        </div>
      )}
    </section>
  );
}
