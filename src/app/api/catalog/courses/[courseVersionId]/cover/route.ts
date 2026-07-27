import { createHash } from "node:crypto";
import { z } from "zod";
import { serviceSupabase } from "@/infrastructure/supabase/server";

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
  context: { params: Promise<{ courseVersionId: string }> },
) {
  try {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const service = serviceSupabase();
    const { data: published, error: publishedError } = await service
      .from("published_course_catalog")
      .select("course_version_id")
      .eq("course_version_id", courseVersionId)
      .maybeSingle();
    if (publishedError || !published) return unavailable();
    const { data: course, error: courseError } = await service
      .from("course_versions")
      .select("cover_path")
      .eq("id", courseVersionId)
      .eq("status", "published")
      .maybeSingle();
    if (courseError || !course?.cover_path) return unavailable();
    const { data: upload, error: uploadError } = await service
      .from("upload_quarantine")
      .select("detected_mime,content_sha256,status")
      .eq("promoted_object_path", course.cover_path)
      .eq("purpose", "course_material")
      .eq("status", "promoted")
      .maybeSingle();
    if (
      uploadError ||
      !upload ||
      !["image/jpeg", "image/png"].includes(upload.detected_mime ?? "")
    ) {
      return unavailable();
    }
    const etag = `"${upload.content_sha256}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "public, max-age=3600" },
      });
    }
    const { data: object, error: downloadError } = await service.storage
      .from("safe-uploads")
      .download(course.cover_path);
    if (downloadError || !object) return unavailable();
    const bytes = Buffer.from(await object.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !== upload.content_sha256
    ) {
      return unavailable(503);
    }
    return new Response(bytes, {
      headers: {
        "cache-control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
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
