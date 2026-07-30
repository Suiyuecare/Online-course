import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const kindSchema = z.enum(["avatar", "cover"]);
const slugSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function unavailable(status = 404) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  try {
    const kind = kindSchema.parse((await context.params).kind);
    const slug = new URL(request.url).searchParams.get("slug");
    const service = serviceSupabase();
    let uploadId: string | null = null;

    if (slug) {
      const parsedSlug = slugSchema.parse(slug);
      const { data: profile, error } = await service
        .from("professional_profiles")
        .select("person_id,avatar_upload_id,cover_upload_id")
        .eq("public_slug", parsedSlug)
        .eq("is_public", true)
        .is("moderation_hidden_at", null)
        .maybeSingle();
      if (error || !profile) return unavailable();
      const { data: person } = await service
        .from("people")
        .select("id")
        .eq("id", profile.person_id)
        .is("anonymized_at", null)
        .maybeSingle();
      if (!person) return unavailable();
      uploadId =
        kind === "avatar" ? profile.avatar_upload_id : profile.cover_upload_id;
    } else {
      const { supabase } = await requireUser();
      const { data: profile, error } = await supabase
        .from("professional_profiles")
        .select("avatar_upload_id,cover_upload_id")
        .maybeSingle();
      if (error || !profile) return unavailable();
      uploadId =
        kind === "avatar" ? profile.avatar_upload_id : profile.cover_upload_id;
    }

    if (!uploadId) return unavailable();
    const { data: upload, error: uploadError } = await service
      .from("upload_quarantine")
      .select(
        "promoted_object_path,promoted_sha256,detected_mime,status,metadata_stripped",
      )
      .eq("id", uploadId)
      .eq("purpose", kind === "avatar" ? "profile_avatar" : "profile_cover")
      .eq("status", "promoted")
      .maybeSingle();
    if (
      uploadError ||
      !upload?.promoted_object_path ||
      !upload.promoted_sha256 ||
      !upload.metadata_stripped ||
      !["image/jpeg", "image/png"].includes(upload.detected_mime ?? "")
    ) {
      return unavailable();
    }

    const etag = `"${upload.promoted_sha256}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "cache-control": "no-store",
        },
      });
    }
    const { data: object, error: downloadError } = await service.storage
      .from("safe-uploads")
      .download(upload.promoted_object_path);
    if (downloadError || !object) return unavailable();
    const bytes = Buffer.from(await object.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      upload.promoted_sha256
    ) {
      return unavailable(503);
    }
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "content-type": upload.detected_mime!,
        "content-disposition": "inline",
        "content-security-policy": "default-src 'none'; sandbox",
        etag,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return unavailable(
      error instanceof Error &&
        error.message === "SUPABASE_SERVER_CONFIGURATION_MISSING"
        ? 503
        : 404,
    );
  }
}
