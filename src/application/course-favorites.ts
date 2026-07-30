import type { SupabaseClient } from "@supabase/supabase-js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CourseFavorite = {
  courseId: string;
  slug: string | null;
  createdAt: string;
};

type FavoriteRelation = {
  course_id?: unknown;
  created_at?: unknown;
  courses?: unknown;
};

function relatedSlug(value: unknown): string | null {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== "object") return null;
  const slug = (relation as { slug?: unknown }).slug;
  return typeof slug === "string" && slugPattern.test(slug) ? slug : null;
}

export async function readOwnCourseFavorites(
  client: SupabaseClient,
): Promise<CourseFavorite[]> {
  const { data, error } = await client
    .from("course_favorites")
    .select("course_id,created_at,courses(slug)")
    .order("created_at", { ascending: false });

  if (error) throw new Error("COURSE_FAVORITES_UNAVAILABLE");

  return (data ?? []).flatMap((candidate) => {
    const row = candidate as FavoriteRelation;
    const slug = relatedSlug(row.courses);
    if (
      typeof row.course_id !== "string" ||
      !uuidPattern.test(row.course_id) ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    ) {
      return [];
    }
    return [
      {
        courseId: row.course_id,
        slug,
        createdAt: row.created_at,
      },
    ];
  });
}
