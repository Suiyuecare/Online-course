import { z } from "zod";
import {
  assertEmergencyCapability,
  assertSameOrigin,
  enforceRateLimit,
  readJson,
} from "@/app/api/_shared/route-helpers";
import { downloadAccreditationExport } from "@/infrastructure/exports/accreditation-export";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertEmergencyCapability(request, "exports");
    await enforceRateLimit(request);
    const { token } = await readJson(
      request,
      z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
    );
    const { supabase } = await requireUser();
    const result = await downloadAccreditationExport({
      actorId: await resolveActivePerson(supabase),
      token,
    });
    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${result.fileName}"`,
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
      { ok: false, error: "EXPORT_DOWNLOAD_REJECTED" },
      {
        status: unavailable ? 503 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
