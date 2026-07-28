"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { useLearnerPortal } from "@/components/learner-portal-store";

export function AddOfficialCourseToCart({ course }: { course: CatalogCourse }) {
  const { addCartItem, cart } = useLearnerPortal();
  const alreadyAdded = cart.some(
    (item) => item.courseVersionId === course.course_version_id,
  );

  return (
    <button
      className="learner-card-cart-action"
      disabled={alreadyAdded}
      onClick={() =>
        addCartItem({
          courseVersionId: course.course_version_id,
          slug: course.slug,
          title: course.title,
          priceTwd: course.price_twd,
          deliveryType: course.delivery_type,
          coverUrl: course.has_cover
            ? `/api/catalog/courses/${course.course_version_id}/cover`
            : null,
        })
      }
      type="button"
    >
      <LearnerPortalIcon name="cart" size={20} />
      {alreadyAdded ? "已在購物車" : "加入購物車"}
    </button>
  );
}

export function ToggleOfficialCourseFavorite({
  course,
}: {
  course: CatalogCourse;
}) {
  const { favoritePendingSlugs, isFavorite, toggleFavorite } =
    useLearnerPortal();
  const selected = isFavorite(course.slug);
  const pending = favoritePendingSlugs.includes(course.slug);

  return (
    <button
      aria-label={`${selected ? "取消收藏" : "收藏"}「${course.title}」`}
      aria-pressed={selected}
      className="learner-card-favorite-action"
      disabled={pending}
      onClick={() => void toggleFavorite(course.slug)}
      type="button"
    >
      <LearnerPortalIcon name="bookmark" size={20} />
      {pending ? "處理中…" : selected ? "已收藏" : "收藏"}
    </button>
  );
}

export function CourseDetailFavoriteAction({
  authenticated,
  initialFavorited,
  slug,
}: {
  authenticated: boolean;
  initialFavorited: boolean;
  slug: string;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!authenticated) {
    return (
      <Link className="button secondary" href="/login">
        <LearnerPortalIcon name="bookmark" size={20} />
        登入後收藏
      </Link>
    );
  }

  async function updateFavorite() {
    const next = !favorited;
    setFavorited(next);
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/favorites", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ slug, favorited: next }),
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        result?.data?.favorited !== next ||
        result?.data?.slug !== slug
      ) {
        throw new Error("COURSE_FAVORITE_REJECTED");
      }
    } catch {
      setFavorited(!next);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="course-detail-favorite">
      <button
        aria-pressed={favorited}
        className="button secondary"
        disabled={pending}
        onClick={() => void updateFavorite()}
        type="button"
      >
        <LearnerPortalIcon name="bookmark" size={20} />
        {pending ? "處理中…" : favorited ? "已收藏" : "收藏課程"}
      </button>
      {failed && <small role="status">收藏沒有更新，請稍後再試。</small>}
    </div>
  );
}
