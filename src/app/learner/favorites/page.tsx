import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  rankCatalogRecommendations,
  type CatalogRecommendationPreferences,
} from "@/application/catalog-recommendations";
import { readOwnCourseFavorites } from "@/application/course-favorites";
import { readOwnLearnerRecommendationPreferences } from "@/application/learner-account-settings";
import { readLearnerCenterRows } from "@/application/learner-center";
import { LearnerFavoritesView } from "@/components/learner-favorites-view";
import { catalogCourseListingWithReadiness } from "@/infrastructure/supabase/catalog";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的收藏" };

export default async function LearnerFavoritesPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const [catalog, favoriteResult, learnerResult, recommendationPreferences] =
    await Promise.all([
      catalogCourseListingWithReadiness(),
      readOwnCourseFavorites(supabase)
        .then((favorites) => ({ available: true as const, favorites }))
        .catch(() => ({ available: false as const, favorites: [] })),
      readLearnerCenterRows(supabase)
        .then((rows) => ({ available: true as const, rows }))
        .catch(() => ({ available: false as const, rows: [] })),
      readOwnLearnerRecommendationPreferences(supabase).catch(
        () =>
          ({
            currentStatus: "undisclosed",
            interests: [],
            learningGoals: [],
          }) satisfies CatalogRecommendationPreferences,
      ),
    ]);
  const favoriteCreatedAt = Object.fromEntries(
    favoriteResult.favorites.flatMap((favorite) =>
      favorite.slug ? [[favorite.slug, favorite.createdAt]] : [],
    ),
  );
  const completedCount = learnerResult.rows.filter((row) =>
    ["completed", "submitted", "credited"].includes(row.enrollment_status),
  ).length;
  const catalogSlugs = new Set(
    catalog.status === "ready"
      ? catalog.courses.map((course) => course.slug)
      : [],
  );
  const unavailableFavorites =
    catalog.status === "ready"
      ? favoriteResult.favorites.filter(
          (favorite) => !favorite.slug || !catalogSlugs.has(favorite.slug),
        )
      : [];
  const recommendations =
    catalog.status === "ready" && learnerResult.available
      ? rankCatalogRecommendations(catalog.courses, recommendationPreferences, {
          courseVersionIds: learnerResult.rows.map(
            (row) => row.course_version_id,
          ),
          slugs: [
            ...learnerResult.rows.map((row) => row.course_slug),
            ...favoriteResult.favorites.flatMap((favorite) =>
              favorite.slug ? [favorite.slug] : [],
            ),
          ],
        }).slice(0, 3)
      : [];

  return (
    <LearnerFavoritesView
      catalogAvailable={catalog.status === "ready"}
      completedCount={completedCount}
      courses={catalog.courses}
      favoriteCreatedAt={favoriteCreatedAt}
      favoritesAvailable={favoriteResult.available}
      recommendations={recommendations}
      unavailableFavorites={unavailableFavorites}
    />
  );
}
