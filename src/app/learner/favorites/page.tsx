import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readOwnCourseFavorites } from "@/application/course-favorites";
import { readLearnerCenterRows } from "@/application/learner-center";
import { LearnerFavoritesView } from "@/components/learner-favorites-view";
import { showcaseCourses } from "@/content/showcase-courses";
import { catalogCourseListing } from "@/infrastructure/supabase/catalog";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的收藏" };

export default async function LearnerFavoritesPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const [catalog, favoriteResult, learnerRows] = await Promise.all([
    catalogCourseListing(),
    readOwnCourseFavorites(supabase)
      .then((favorites) => ({ available: true, favorites }))
      .catch(() => ({ available: false, favorites: [] })),
    readLearnerCenterRows(supabase).catch(() => []),
  ]);
  const favoriteCreatedAt = Object.fromEntries(
    favoriteResult.favorites.map((favorite) => [
      favorite.slug,
      favorite.createdAt,
    ]),
  );
  const completedCount = learnerRows.filter((row) =>
    ["completed", "submitted", "credited"].includes(row.enrollment_status),
  ).length;

  return (
    <LearnerFavoritesView
      catalogAvailable={catalog.status === "ready"}
      completedCount={completedCount}
      courses={catalog.courses}
      favoriteCreatedAt={favoriteCreatedAt}
      favoritesAvailable={favoriteResult.available}
      recommendations={showcaseCourses.slice(0, 3)}
    />
  );
}
