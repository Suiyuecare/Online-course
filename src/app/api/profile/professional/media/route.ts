import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const mediaSchema = z.object({
  kind: z.enum(["avatar", "cover"]),
  uploadId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, mediaSchema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "bind_own_professional_profile_media",
      {
        p_kind: input.kind,
        p_upload_id: input.uploadId,
        p_expected_version: input.expectedVersion,
      },
    );
    if (error || !data) {
      throw new Error(
        error?.message.includes("VERSION_CONFLICT")
          ? "PROFESSIONAL_PROFILE_VERSION_CONFLICT"
          : "PROFESSIONAL_PROFILE_MEDIA_REJECTED",
      );
    }
    return data;
  });
}
