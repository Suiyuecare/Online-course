import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const favoriteSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  favorited: z.boolean(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, favoriteSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("set_own_course_favorite", {
      p_course_slug: input.slug,
      p_favorited: input.favorited,
    });
    if (error || !data) throw new Error("COURSE_FAVORITE_REJECTED");
    return data;
  });
}
