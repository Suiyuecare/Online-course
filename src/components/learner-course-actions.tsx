"use client";

import type { ShowcaseCourse } from "@/content/showcase-courses";
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

export function ToggleShowcaseFavorite({ course }: { course: ShowcaseCourse }) {
  const { isFavorite, toggleFavorite } = useLearnerPortal();
  const selected = isFavorite(course.slug);

  return (
    <button
      aria-pressed={selected}
      className="learner-card-favorite-action"
      onClick={() => toggleFavorite(course.slug)}
      type="button"
    >
      <LearnerPortalIcon name="bookmark" size={20} />
      {selected ? "已收藏" : "收藏"}
    </button>
  );
}
