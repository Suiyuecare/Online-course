import { readSurveyInvestigationWorkspace } from "@/application/quality-workspace";
import { qualityWorkspaceQuerySchema } from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = qualityWorkspaceQuerySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const { supabase } = await requireUser();
    const { data: authorized, error: authorizationError } = await supabase.rpc(
      "authorize_staff_action",
      {
        p_required_role: "platform_admin",
        p_action: "staff.quality.survey_investigations.read",
        p_target: "survey_investigations",
      },
    );
    if (authorizationError || authorized !== true) {
      throw new Error("SURVEY_INVESTIGATION_WORKSPACE_REJECTED");
    }
    const data = await readSurveyInvestigationWorkspace(supabase, input);
    return Response.json(
      { ok: true, data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.split(":")[0]
        : "SURVEY_INVESTIGATION_WORKSPACE_REJECTED";
    return Response.json(
      { ok: false, error: code },
      {
        status: code === "AUTHENTICATION_REQUIRED" ? 401 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
