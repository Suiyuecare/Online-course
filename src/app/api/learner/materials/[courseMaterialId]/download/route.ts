import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertEmergencyCapability,
  assertSameOrigin,
  enforceRateLimit,
} from "@/app/api/_shared/route-helpers";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const materialReferenceSchema = z.object({
  objectPath: z.string().min(1),
  detectedMime: z.enum([
    "image/jpeg",
    "image/png",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ]),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const extensions: Record<
  z.infer<typeof materialReferenceSchema>["detectedMime"],
  string
> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ courseMaterialId: string }> },
) {
  try {
    assertSameOrigin(request);
    assertEmergencyCapability(request);
    await enforceRateLimit(request);
    const { courseMaterialId } = await context.params;
    z.uuid().parse(courseMaterialId);
    const { supabase } = await requireUser();
    const personId = await resolveActivePerson(supabase);
    const service = serviceSupabase();
    const { data, error } = await service.rpc(
      "read_learner_course_material_reference",
      {
        p_course_material_id: courseMaterialId,
        p_person_id: personId,
      },
    );
    const reference = materialReferenceSchema.safeParse(data);
    if (error || !reference.success) {
      throw new Error("COURSE_MATERIAL_NOT_AUTHORIZED");
    }
    const { data: object, error: objectError } = await service.storage
      .from("safe-uploads")
      .download(reference.data.objectPath);
    if (objectError || !object) throw new Error("COURSE_MATERIAL_UNAVAILABLE");
    const bytes = Buffer.from(await object.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      reference.data.contentSha256
    ) {
      throw new Error("COURSE_MATERIAL_INTEGRITY_FAILED");
    }
    const extension = extensions[reference.data.detectedMime];
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="suiyue-material-${courseMaterialId}.${extension}"`,
        "content-type": reference.data.detectedMime,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      (error.message.includes("CONFIGURATION") ||
        error.message.includes("UNAVAILABLE") ||
        error.message.includes("EMERGENCY_CLOSED"));
    return Response.json(
      { ok: false, error: "COURSE_MATERIAL_DOWNLOAD_REJECTED" },
      {
        status: unavailable ? 503 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
