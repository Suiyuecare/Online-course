import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canManageOrganization,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const assignSchema = z.object({
  organizationId: z.string().uuid(),
  lotId: z.string().uuid(),
  learnerId: z.string().uuid(),
  dueAt: z.string().datetime().nullable().optional(),
  liveSessionId: z.string().uuid().nullable().optional(),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("release"),
    organizationId: z.string().uuid(),
    allocationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("select_session"),
    organizationId: z.string().uuid(),
    allocationId: z.string().uuid(),
    liveSessionId: z.string().uuid(),
  }),
]);

async function authorize(organizationId: string) {
  const client = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(client);
  const admin = createSupabaseAdminClient();
  const context =
    identity && admin
      ? await getOrganizationContext(admin, identity.id, organizationId)
      : null;
  return { identity, admin, context };
}

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = assignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ASSIGNMENT" }, { status: 400 });
  const { identity, admin, context } = await authorize(
    parsed.data.organizationId,
  );
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const [{ data: member }, { data: lot }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id,profiles(full_name)")
      .eq("organization_id", context.organizationId)
      .eq("user_id", parsed.data.learnerId)
      .maybeSingle(),
    admin
      .from("enterprise_seat_lots")
      .select("id,organization_id,course_id,status,valid_until,courses(title,delivery)")
      .eq("id", parsed.data.lotId)
      .eq("organization_id", context.organizationId)
      .maybeSingle(),
  ]);
  if (!member || !lot)
    return NextResponse.json({ error: "MEMBER_OR_LOT_NOT_FOUND" }, { status: 404 });
  const course = Array.isArray(lot.courses) ? lot.courses[0] : lot.courses;
  if (lot.status !== "active" || Date.parse(lot.valid_until) <= Date.now())
    return NextResponse.json({ error: "SEAT_LOT_NOT_AVAILABLE" }, { status: 409 });
  if (course?.delivery === "recorded" && parsed.data.liveSessionId)
    return NextResponse.json({ error: "RECORDED_HAS_NO_SESSION" }, { status: 400 });
  if (
    course?.delivery === "live" &&
    process.env.FEATURE_LIVE_COURSES !== "true"
  )
    return NextResponse.json({ error: "LIVE_FEATURE_DISABLED" }, { status: 404 });
  const { data, error } = await admin.rpc("assign_enterprise_seat", {
    target_lot_id: parsed.data.lotId,
    target_learner_id: parsed.data.learnerId,
    target_due_at: parsed.data.dueAt ?? null,
    target_live_session_id: parsed.data.liveSessionId ?? null,
    target_actor_id: identity.id,
  });
  if (error)
    return NextResponse.json(
      {
        error: error.message.includes("NO_AVAILABLE")
          ? "NO_AVAILABLE_SEATS"
          : error.message.includes("ALREADY")
            ? "ALREADY_ENTITLED"
            : error.message.includes("FULL")
              ? "LIVE_SESSION_FULL"
              : "ASSIGNMENT_FAILED",
        message: error.message,
      },
      { status: 409 },
    );
  const assignedAllocation = Array.isArray(data) ? data[0] : data;
  if (!assignedAllocation?.id)
    return NextResponse.json(
      { error: "ASSIGNMENT_RESULT_MISSING" },
      { status: 500 },
    );
  const profile = Array.isArray(member.profiles)
    ? member.profiles[0]
    : member.profiles;
  const [{ data: learner }, { data: liveSession }] = await Promise.all([
    admin.auth.admin.getUserById(parsed.data.learnerId),
    parsed.data.liveSessionId
      ? admin
          .from("live_sessions")
          .select("id,title,starts_at")
          .eq("id", parsed.data.liveSessionId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (learner.user?.email)
    await sendEnterpriseEmail({
      kind: parsed.data.liveSessionId ? "live_session" : "assignment",
      to: learner.user.email,
      organizationId: context.organizationId,
      referenceId: parsed.data.liveSessionId
        ? `${assignedAllocation.id}:${parsed.data.liveSessionId}:${assignedAllocation.booking_id ?? assignedAllocation.updated_at}`
        : assignedAllocation.id,
      organizationName: context.organization.name,
      learnerName: profile?.full_name || undefined,
      courseTitle: course?.title ?? "歲悅課程",
      sessionTitle: liveSession?.title ?? undefined,
      sessionStartsAt: liveSession?.starts_at ?? undefined,
      dueAt: parsed.data.dueAt ?? undefined,
      request,
    }).catch(() => undefined);
  return NextResponse.json({ allocation: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  const { identity, admin, context } = await authorize(
    parsed.data.organizationId,
  );
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  if (
    parsed.data.action === "select_session" &&
    process.env.FEATURE_LIVE_COURSES !== "true"
  )
    return NextResponse.json({ error: "LIVE_FEATURE_DISABLED" }, { status: 404 });
  const { data: allocation } = await admin
    .from("enterprise_seat_allocations")
    .select("id,organization_id,learner_id,course_id")
    .eq("id", parsed.data.allocationId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (!allocation)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const rpc =
    parsed.data.action === "release"
      ? await admin.rpc("release_enterprise_seat", {
          target_allocation_id: allocation.id,
          target_actor_id: identity.id,
        })
      : await admin.rpc("select_enterprise_live_session", {
          target_allocation_id: allocation.id,
          target_session_id: parsed.data.liveSessionId,
          target_actor_id: identity.id,
        });
  if (rpc.error)
    return NextResponse.json(
      {
        error: rpc.error.message.includes("24_HOURS")
          ? "CHANGE_WINDOW_CLOSED"
          : rpc.error.message.includes("FULL")
            ? "LIVE_SESSION_FULL"
            : "ALLOCATION_UPDATE_FAILED",
        message: rpc.error.message,
      },
      { status: 409 },
    );
  if (parsed.data.action === "select_session") {
    const updatedAllocation = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const [learnerResult, profileResult, courseResult, sessionResult] =
      await Promise.all([
        admin.auth.admin.getUserById(allocation.learner_id),
        admin
          .from("profiles")
          .select("full_name")
          .eq("id", allocation.learner_id)
          .maybeSingle(),
        admin
          .from("courses")
          .select("title")
          .eq("id", allocation.course_id)
          .maybeSingle(),
        admin
          .from("live_sessions")
          .select("title,starts_at")
          .eq("id", parsed.data.liveSessionId)
          .maybeSingle(),
      ]);
    if (learnerResult.data.user?.email)
      await sendEnterpriseEmail({
        kind: "live_session",
        to: learnerResult.data.user.email,
        organizationId: context.organizationId,
        referenceId: `${allocation.id}:${parsed.data.liveSessionId}:${updatedAllocation?.booking_id ?? updatedAllocation?.updated_at}`,
        organizationName: context.organization.name,
        learnerName: profileResult.data?.full_name || undefined,
        courseTitle: courseResult.data?.title ?? "歲悅直播課程",
        sessionTitle: sessionResult.data?.title ?? undefined,
        sessionStartsAt: sessionResult.data?.starts_at ?? undefined,
        request,
      }).catch(() => undefined);
  }
  return NextResponse.json({ allocation: rpc.data });
}
