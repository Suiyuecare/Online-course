import { z } from "zod";
import {
  assertEmergencyCapability,
  enforceRateLimit,
} from "@/app/api/_shared/route-helpers";
import {
  buildOrganizationTrainingWorkbook,
  organizationTrainingReport,
} from "@/infrastructure/exports/organization-training-workbook";
import { requireUser } from "@/infrastructure/supabase/server";

const querySchema = z.object({
  courseVersionId: z.uuid().nullable(),
  liveSessionId: z.uuid().nullable(),
  department: z.string().trim().min(1).max(100).nullable(),
  status: z
    .enum([
      "reserved",
      "active",
      "consumed",
      "released",
      "completed",
      "cancelled",
      "refunded",
    ])
    .nullable(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  try {
    assertEmergencyCapability(request, "exports");
    await enforceRateLimit(request);
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const url = new URL(request.url);
    const query = querySchema.parse({
      courseVersionId: url.searchParams.get("courseVersionId") || null,
      liveSessionId: url.searchParams.get("liveSessionId") || null,
      department: url.searchParams.get("department") || null,
      status: url.searchParams.get("status") || null,
    });
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "read_organization_training_report_v3",
      {
        p_organization_id: organizationId,
        p_course_version_id: query.courseVersionId,
        p_live_session_id: query.liveSessionId,
        p_department: query.department,
        p_status: query.status,
      },
    );
    if (error || !data) throw new Error("ORGANIZATION_REPORT_REJECTED");
    const report = organizationTrainingReport.parse(data);
    const bytes = await buildOrganizationTrainingWorkbook(report);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          'attachment; filename="suiyue-organization-training.xlsx"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      (error.message.includes("EMERGENCY_CLOSED") ||
        error.message.includes("CONFIGURATION") ||
        error.message.includes("UNAVAILABLE"));
    return Response.json(
      { ok: false, error: "ORGANIZATION_REPORT_REJECTED" },
      {
        status: unavailable ? 503 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
