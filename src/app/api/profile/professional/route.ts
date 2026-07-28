import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const tag = z.string().trim().min(2).max(40);
const profileSchema = z.object({
  publicName: z.string().trim().min(2).max(80),
  headline: z.string().trim().max(120),
  websiteUrl: z
    .union([z.literal(""), z.url().max(500)])
    .refine(
      (value) =>
        value === "" || ["http:", "https:"].includes(new URL(value).protocol),
      "WEBSITE_PROTOCOL_REJECTED",
    ),
  biography: z.string().trim().max(1000),
  expertise: z.array(tag).max(12),
  interests: z.array(tag).max(12),
  isPublic: z.boolean(),
  showAbout: z.boolean(),
  showCompletedCourses: z.boolean(),
  showTeachingCourses: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, profileSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "upsert_own_professional_profile",
      {
        p_public_name: input.publicName,
        p_headline: input.headline,
        p_website_url: input.websiteUrl,
        p_biography: input.biography,
        p_expertise: [...new Set(input.expertise)],
        p_interests: [...new Set(input.interests)],
        p_is_public: input.isPublic,
        p_show_about: input.showAbout,
        p_show_completed_courses: input.showCompletedCourses,
        p_show_teaching_courses: input.showTeachingCourses,
        p_expected_version: input.expectedVersion,
      },
    );
    if (error || !data) {
      throw new Error(
        error?.message.includes("VERSION_CONFLICT")
          ? "PROFESSIONAL_PROFILE_VERSION_CONFLICT"
          : "PROFESSIONAL_PROFILE_REJECTED",
      );
    }
    return data;
  });
}
