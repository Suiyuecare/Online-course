import { readCertificateRevocationWorkspace } from "@/application/quality-workspace";
import { qualityWorkspaceQuerySchema } from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = qualityWorkspaceQuerySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const { supabase } = await requireUser();
    const { data: authorized, error: authorizationError } = await supabase.rpc(
      "authorize_staff_action",
      {
        p_required_role: "accreditation_reviewer",
        p_action: "staff.quality.certificate_revocations.read",
        p_target: "certificate_revocations",
      },
    );
    if (authorizationError || authorized !== true) {
      throw new Error("CERTIFICATE_REVOCATION_WORKSPACE_REJECTED");
    }
    const data = await readCertificateRevocationWorkspace(supabase, input);
    return Response.json(
      { ok: true, data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.split(":")[0]
        : "CERTIFICATE_REVOCATION_WORKSPACE_REJECTED";
    return Response.json(
      { ok: false, error: code },
      {
        status: code === "AUTHENTICATION_REQUIRED" ? 401 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
