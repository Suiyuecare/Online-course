import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
} from "@/lib/supabase/server";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("release"),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("select_session"),
    liveSessionId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const [{ allocationId }, body, actorId] = await Promise.all([
    params,
    request.json().catch(() => null),
    getAuthenticatedUserId(),
  ]);
  const parsed = schema.safeParse(body);
  if (!z.string().uuid().safeParse(allocationId).success || !parsed.success)
    return NextResponse.json({ error: "INVALID_ALLOCATION_ACTION" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!actorId || !admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: allocation } = await admin
    .from("enterprise_seat_allocations")
    .select("id,organization_id,learner_id,course_id,live_session_id,status")
    .eq("id", allocationId)
    .maybeSingle();
  if (!allocation)
    return NextResponse.json({ error: "ALLOCATION_NOT_FOUND" }, { status: 404 });
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: allocation.organization_id,
    action: "enterprise.admin_allocation_action_requested",
    target_type: "enterprise_seat_allocation",
    target_id: allocation.id,
    before_data: {
      status: allocation.status,
      live_session_id: allocation.live_session_id,
    },
    after_data: {
      action: parsed.data.action,
      reason: parsed.data.reason,
      live_session_id:
        parsed.data.action === "select_session"
          ? parsed.data.liveSessionId
          : null,
    },
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "ALLOCATION_AUDIT_FAILED" },
      { status: 503 },
    );
  const result =
    parsed.data.action === "release"
      ? await admin.rpc("release_enterprise_seat", {
          target_allocation_id: allocation.id,
          target_actor_id: actorId,
        })
      : await admin.rpc("select_enterprise_live_session", {
          target_allocation_id: allocation.id,
          target_session_id: parsed.data.liveSessionId,
          target_actor_id: actorId,
        });
  if (result.error)
    return NextResponse.json(
      {
        error: result.error.message.includes("CHECKED_IN")
          ? "LEARNER_ALREADY_CHECKED_IN"
          : result.error.message.includes("CONSUMED")
            ? "SEAT_ALREADY_CONSUMED"
            : result.error.message.includes("FULL")
              ? "LIVE_SESSION_FULL"
              : "ALLOCATION_ACTION_FAILED",
        message: result.error.message,
      },
      { status: 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: allocation.organization_id,
    action: `enterprise.admin_allocation_${parsed.data.action}`,
    target_type: "enterprise_seat_allocation",
    target_id: allocation.id,
    before_data: {
      status: allocation.status,
      live_session_id: allocation.live_session_id,
    },
    after_data: {
      reason: parsed.data.reason,
      live_session_id:
        parsed.data.action === "select_session"
          ? parsed.data.liveSessionId
          : null,
    },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "ALLOCATION_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );

  if (parsed.data.action === "select_session") {
    const updatedAllocation = Array.isArray(result.data)
      ? result.data[0]
      : result.data;
    const [userResult, profileResult, organizationResult, courseResult, sessionResult] =
      await Promise.all([
        admin.auth.admin.getUserById(allocation.learner_id),
        admin.from("profiles").select("full_name").eq("id", allocation.learner_id).maybeSingle(),
        admin.from("organizations").select("name").eq("id", allocation.organization_id).maybeSingle(),
        admin.from("courses").select("title").eq("id", allocation.course_id).maybeSingle(),
        admin.from("live_sessions").select("title,starts_at").eq("id", parsed.data.liveSessionId).maybeSingle(),
      ]);
    if (
      userResult.data.user?.email &&
      organizationResult.data &&
      sessionResult.data
    )
      await sendEnterpriseEmail({
        kind: "live_session",
        to: userResult.data.user.email,
        organizationId: allocation.organization_id,
        referenceId: `${allocation.id}:${parsed.data.liveSessionId}:${updatedAllocation?.booking_id ?? updatedAllocation?.updated_at}`,
        organizationName: organizationResult.data.name,
        learnerName: profileResult.data?.full_name || undefined,
        courseTitle: courseResult.data?.title ?? "歲悅直播課程",
        sessionTitle: sessionResult.data.title,
        sessionStartsAt: sessionResult.data.starts_at,
        request,
      }).catch(() => undefined);
  }
  return NextResponse.json({ allocation: result.data });
}
