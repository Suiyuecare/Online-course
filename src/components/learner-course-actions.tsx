"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  CatalogCourse,
  InternalCatalogCourse,
} from "@/infrastructure/supabase/catalog";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { useLearnerPortal } from "@/components/learner-portal-store";
import {
  anonymousLearnerCartStorageKey,
  mergeLearnerCartItems,
  notifyLearnerCartChanged,
  parseLearnerCartStorage,
  serializeLearnerCartStorage,
  type LearnerCartItem,
} from "@/domain/learner-cart";

function cartItemFromCourse(course: InternalCatalogCourse): LearnerCartItem {
  return {
    courseVersionId: course.course_version_id,
    slug: course.slug,
    title: course.title,
    priceTwd: course.price_twd,
    deliveryType: course.delivery_type,
    hasCover: course.has_cover,
    available: true,
    addedAt: new Date().toISOString(),
  };
}

export function AddPublicCourseToCart({
  className = "learner-card-cart-action",
  course,
}: {
  className?: string;
  course: InternalCatalogCourse;
}) {
  const [added, setAdded] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = parseLearnerCartStorage(
        window.localStorage.getItem(anonymousLearnerCartStorageKey),
      );
      setAdded(
        current.some(
          (item) => item.courseVersionId === course.course_version_id,
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [course.course_version_id]);

  function stageOnThisDevice(item: LearnerCartItem) {
    const current = parseLearnerCartStorage(
      window.localStorage.getItem(anonymousLearnerCartStorageKey),
    );
    const next = mergeLearnerCartItems(current, [item]);
    if (
      !next.some(
        (candidate) => candidate.courseVersionId === item.courseVersionId,
      )
    ) {
      setAnnouncement("購物車已達 100 門上限，這門課尚未加入。");
      return false;
    }
    window.localStorage.setItem(
      anonymousLearnerCartStorageKey,
      serializeLearnerCartStorage(next),
    );
    notifyLearnerCartChanged();
    return true;
  }

  function addToCart() {
    const item = cartItemFromCourse(course);
    if (!stageOnThisDevice(item)) return;
    setAdded(true);
    setAnnouncement(`已暫存 ${course.title}；登入後會自動合併到你的購物車。`);
  }

  return (
    <>
      <button
        className={className}
        disabled={added}
        onClick={addToCart}
        type="button"
      >
        <LearnerPortalIcon name="cart" size={20} />
        {added ? "已加入購物車" : "加入購物車"}
      </button>
      <span
        aria-atomic="true"
        aria-live="polite"
        className="visually-hidden"
        role="status"
      >
        {announcement}
      </span>
    </>
  );
}

export function AddOfficialCourseToCart({
  course,
}: {
  course: InternalCatalogCourse;
}) {
  const { addCartItem, cart, cartPendingIds, cartSyncStatus } =
    useLearnerPortal();
  const alreadyAdded = cart.some(
    (item) => item.courseVersionId === course.course_version_id,
  );
  const pending = cartPendingIds.includes(course.course_version_id);
  const synchronizing = cartSyncStatus === "syncing";

  return (
    <button
      className="learner-card-cart-action"
      disabled={alreadyAdded || pending || synchronizing}
      onClick={() => void addCartItem(cartItemFromCourse(course))}
      type="button"
    >
      <LearnerPortalIcon name="cart" size={20} />
      {synchronizing
        ? "同步購物車…"
        : pending
          ? "同步中…"
          : alreadyAdded
            ? "已在購物車"
            : "加入購物車"}
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
