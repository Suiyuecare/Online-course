import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertEmergencyCapability,
  assertSameOrigin,
  enforceRateLimit,
} from "@/app/api/_shared/route-helpers";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ certificateId: string }> },
) {
  try {
    assertSameOrigin(request);
    assertEmergencyCapability(request, "certificates");
    await enforceRateLimit(request);
    const { certificateId } = await context.params;
    z.uuid().parse(certificateId);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "authorize_certificate_download",
      { p_certificate_id: certificateId },
    );
    const authorized = z
      .object({
        objectPath: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        fileName: z.string().regex(/^suiyue-certificate-[a-f0-9-]+\.pdf$/),
      })
      .safeParse(data);
    if (error || !authorized.success) throw new Error("NOT_AUTHORIZED");
    const { data: object, error: objectError } = await serviceSupabase()
      .storage.from("certificates")
      .download(authorized.data.objectPath);
    if (objectError) throw new Error("OBJECT_UNAVAILABLE");
    const bytes = Buffer.from(await object.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      authorized.data.sha256
    ) {
      throw new Error("INTEGRITY_FAILED");
    }
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${authorized.data.fileName}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      (error.message.includes("EMERGENCY_CLOSED") ||
        error.message.includes("CONFIGURATION") ||
        error.message.includes("UNAVAILABLE"));
    return Response.json(
      { ok: false, error: "CERTIFICATE_DOWNLOAD_REJECTED" },
      {
        status: unavailable ? 503 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
