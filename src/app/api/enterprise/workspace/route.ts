import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canManageOrganization,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
  organizationContextForClient,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const WORKSPACE_PAGE_SIZE = 500;
const WORKSPACE_IN_CHUNK_SIZE = 100;

type PagedResult<T> = {
  data: T[];
  error: { message: string } | null;
};

async function collectPages<T>(
  loader: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  enabled = true,
): Promise<PagedResult<T>> {
  if (!enabled) return { data: [], error: null };
  const data: T[] = [];
  for (let from = 0; ; from += WORKSPACE_PAGE_SIZE) {
    const result = await loader(from, from + WORKSPACE_PAGE_SIZE - 1);
    if (result.error) return { data, error: result.error };
    const page = result.data ?? [];
    data.push(...page);
    if (page.length < WORKSPACE_PAGE_SIZE) break;
  }
  return { data, error: null };
}

async function collectChunkedPages<T>(
  values: string[],
  loader: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<PagedResult<T>> {
  const data: T[] = [];
  for (let index = 0; index < values.length; index += WORKSPACE_IN_CHUNK_SIZE) {
    const chunk = values.slice(index, index + WORKSPACE_IN_CHUNK_SIZE);
    const result = await collectPages((from, to) =>
      loader(chunk, from, to),
    );
    if (result.error) return { data, error: result.error };
    data.push(...result.data);
  }
  return { data, error: null };
}

export async function GET(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });

  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  if (!z.string().uuid().safeParse(organizationId).success)
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });

  const context = await getOrganizationContext(
    admin,
    identity.id,
    organizationId,
  );
  if (!context)
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );

  const manager = canManageOrganization(context.role);
  const liveCoursesEnabled = process.env.FEATURE_LIVE_COURSES === "true";
  const currentIso = new Date().toISOString();
  const [
    memberResult,
    invitationResult,
    lotResult,
    allocationResult,
    seatEventResult,
    orderResult,
    invoiceResult,
    courseResult,
    tierResult,
    liveSessionResult,
    enrollmentResult,
  ] = await Promise.all([
    collectPages((from, to) => {
      let query = admin
        .from("organization_members")
        .select(
          "organization_id,user_id,role,employee_code,department,joined_at",
        )
        .eq("organization_id", context.organizationId);
      if (!manager) query = query.eq("user_id", identity.id);
      return query
        .order("joined_at")
        .order("user_id")
        .range(from, to);
    }),
    collectPages(
      (from, to) =>
        admin
          .from("organization_invitations")
          .select(
            "id,email,invitee_name,employee_code,department,role,status,expires_at,accepted_at,created_at",
          )
          .eq("organization_id", context.organizationId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      manager,
    ),
    collectPages(
      (from, to) =>
        admin
          .from("enterprise_seat_lots")
          .select(
            "id,organization_id,course_id,source_order_id,purchased_quantity,total_quantity,available_quantity,unit_price_twd,purchased_at,valid_until,status,created_at",
          )
          .eq("organization_id", context.organizationId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      manager,
    ),
    collectPages((from, to) => {
      let query = admin
        .from("enterprise_seat_allocations")
        .select(
          "id,seat_lot_id,learner_id,course_id,live_session_id,due_at,status,assigned_at,consumed_at",
        )
        .eq("organization_id", context.organizationId);
      if (!manager) query = query.eq("learner_id", identity.id);
      return query
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to);
    }),
    manager
      ? admin
          .from("enterprise_seat_events")
          .select(
            "id,seat_lot_id,allocation_id,event_type,quantity,available_delta,occurred_at",
          )
          .eq("organization_id", context.organizationId)
          .order("occurred_at", { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    collectPages(
      (from, to) =>
        admin
          .from("orders")
          .select(
            "id,merchant_trade_no,status,amount_twd,paid_at,created_at",
          )
          .eq("organization_id", context.organizationId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      manager,
    ),
    collectPages(
      (from, to) =>
        admin
          .from("invoice_records")
          .select(
            "id,order_id,refund_id,record_type,status,amount_twd,invoice_number,invoice_date,allowance_number,allowance_status,allowance_expires_at,error_message",
          )
          .eq("organization_id", context.organizationId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      manager,
    ),
    collectPages((from, to) =>
      admin
        .from("courses")
        .select("id,slug,title,delivery,accredited,status")
        .eq("status", "published")
        .in(
          "delivery",
          liveCoursesEnabled ? ["recorded", "live"] : ["recorded"],
        )
        .order("title")
        .order("id")
        .range(from, to),
    ),
    collectPages(
      (from, to) =>
        admin
          .from("course_price_tiers")
          .select(
            "id,course_id,min_quantity,max_quantity,unit_price_twd,effective_at,expires_at,active",
          )
          .eq("active", true)
          .lte("effective_at", currentIso)
          .or(`expires_at.is.null,expires_at.gt.${currentIso}`)
          .order("course_id")
          .order("min_quantity")
          .order("id")
          .range(from, to),
      manager,
    ),
    collectPages(
      (from, to) =>
        admin
          .from("live_sessions")
          .select(
            "id,course_id,title,starts_at,ends_at,status,capacity,live_session_bookings(id,status)",
          )
          .in("status", ["scheduled", "open"])
          .gt("starts_at", currentIso)
          .order("starts_at")
          .order("id")
          .range(from, to),
      manager && liveCoursesEnabled,
    ),
    collectPages((from, to) => {
      let query = admin
        .from("enrollments")
        .select(
          "id,learner_id,course_id,live_session_id,status,progress_percent,quiz_passed,satisfaction_completed,completed_at",
        )
        .eq("organization_id", context.organizationId);
      if (!manager) query = query.eq("learner_id", identity.id);
      return query.order("id").range(from, to);
    }),
  ]);
  if (
    [
      memberResult,
      invitationResult,
      lotResult,
      allocationResult,
      seatEventResult,
      orderResult,
      invoiceResult,
      courseResult,
      tierResult,
      liveSessionResult,
      enrollmentResult,
    ].some((result) => result.error)
  )
    return NextResponse.json(
      { error: "WORKSPACE_QUERY_FAILED" },
      { status: 503 },
    );

  const currentLiveSessions = liveSessionResult.data ?? [];
  const currentLiveSessionIds = new Set(
    currentLiveSessions.map((session) => session.id),
  );
  const referencedLiveSessionIds = [
    ...new Set(
      (allocationResult.data ?? [])
        .map((allocation) => allocation.live_session_id)
        .filter(
          (sessionId): sessionId is string =>
            typeof sessionId === "string" &&
            !currentLiveSessionIds.has(sessionId),
        ),
    ),
  ];
  const referencedLiveSessions: typeof currentLiveSessions = [];
  for (let index = 0; index < referencedLiveSessionIds.length; index += 100) {
    const { data: sessions, error } = await admin
      .from("live_sessions")
      .select("id,course_id,title,starts_at,ends_at,status,capacity")
      .in("id", referencedLiveSessionIds.slice(index, index + 100));
    if (error)
      return NextResponse.json(
        { error: "WORKSPACE_LIVE_SESSION_QUERY_FAILED" },
        { status: 503 },
      );
    referencedLiveSessions.push(
      ...(sessions ?? []).map((session) => ({
        ...session,
        live_session_bookings: [],
      })),
    );
  }

  const publishedCourseIds = new Set(
    courseResult.data.map((course) => course.id),
  );
  const referencedCourseIds = [
    ...new Set(
      [
        ...lotResult.data.map((lot) => lot.course_id),
        ...allocationResult.data.map((allocation) => allocation.course_id),
        ...enrollmentResult.data.map((enrollment) => enrollment.course_id),
      ].filter(
        (courseId): courseId is string =>
          typeof courseId === "string" && !publishedCourseIds.has(courseId),
      ),
    ),
  ];
  const referencedCourseResult = await collectChunkedPages(
    referencedCourseIds,
    (chunk, from, to) =>
      admin
        .from("courses")
        .select("id,slug,title,delivery,accredited,status")
        .in("id", chunk)
        .order("id")
        .range(from, to),
  );
  if (referencedCourseResult.error)
    return NextResponse.json(
      { error: "WORKSPACE_COURSE_REFERENCE_QUERY_FAILED" },
      { status: 503 },
    );
  const allReferencedCourses = [
    ...courseResult.data,
    ...referencedCourseResult.data,
  ];

  const members = memberResult.data ?? [];
  const userIds = members.map((member) => member.user_id);
  const orderIds = (orderResult.data ?? []).map((order) => order.id);
  const enrollmentIds = (enrollmentResult.data ?? []).map(
    (enrollment) => enrollment.id,
  );
  const [
    profileResult,
    orderItemResult,
    refundResult,
    certificateResult,
    accreditationResult,
    acceptedInvitationResult,
  ] =
    await Promise.all([
      collectChunkedPages(userIds, (chunk, from, to) =>
        admin
          .from("profiles")
          .select("id,full_name")
          .in("id", chunk)
          .order("id")
          .range(from, to),
      ),
      collectChunkedPages(orderIds, (chunk, from, to) =>
        admin
          .from("order_items")
          .select(
            "id,order_id,course_id,live_session_id,quantity,unit_price_twd",
          )
          .in("order_id", chunk)
          .order("order_id")
          .order("id")
          .range(from, to),
      ),
      manager
        ? collectChunkedPages(orderIds, (chunk, from, to) =>
            admin
              .from("refunds")
              .select(
                "id,order_id,status,amount_twd,seat_quantity,created_at",
              )
              .in("order_id", chunk)
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to),
          )
        : Promise.resolve({ data: [], error: null }),
      collectChunkedPages(enrollmentIds, (chunk, from, to) =>
        admin
          .from("certificates")
          .select("enrollment_id,verification_code,issued_at,revoked_at")
          .in("enrollment_id", chunk)
          .is("revoked_at", null)
          .order("enrollment_id")
          .range(from, to),
      ),
      collectChunkedPages(enrollmentIds, (chunk, from, to) =>
        admin
          .from("accreditation_registrations")
          .select("enrollment_id,status")
          .in("enrollment_id", chunk)
          .order("enrollment_id")
          .range(from, to),
      ),
      collectChunkedPages(userIds, (chunk, from, to) =>
        admin
          .from("organization_invitations")
          .select("accepted_by,email,invitee_name,status")
          .eq("organization_id", context.organizationId)
          .eq("status", "accepted")
          .in("accepted_by", chunk)
          .order("accepted_by")
          .range(from, to),
      ),
    ]);
  if (
    [
      profileResult,
      orderItemResult,
      refundResult,
      certificateResult,
      accreditationResult,
      acceptedInvitationResult,
    ].some((result) => result.error)
  )
    return NextResponse.json(
      { error: "WORKSPACE_RELATION_QUERY_FAILED" },
      { status: 503 },
    );

  const profileByUser = new Map(
    profileResult.data.map((profile) => [profile.id, profile]),
  );
  const acceptedInvitationByUser = new Map(
    acceptedInvitationResult.data.map((invitation) => [
      invitation.accepted_by,
      invitation,
    ]),
  );
  const authEmailByUser = new Map<string, string>();
  const legacyMembers = members.filter(
    (member) => !acceptedInvitationByUser.get(member.user_id)?.email,
  );
  for (let index = 0; index < legacyMembers.length; index += 20) {
    const chunk = legacyMembers.slice(index, index + 20);
    const results = await Promise.all(
      chunk.map((member) => admin.auth.admin.getUserById(member.user_id)),
    );
    if (results.some((result) => result.error))
      return NextResponse.json(
        { error: "WORKSPACE_MEMBER_LOOKUP_FAILED" },
        { status: 503 },
      );
    results.forEach((result, resultIndex) => {
      const email = result.data.user?.email?.trim().toLowerCase();
      if (email) authEmailByUser.set(chunk[resultIndex].user_id, email);
    });
  }
  const memberDetails = members.map((member) => {
    const profile = profileByUser.get(member.user_id);
    const invitation = acceptedInvitationByUser.get(member.user_id);
    return {
      ...member,
      fullName:
        profile?.full_name?.trim() || invitation?.invitee_name?.trim() || "",
      email: invitation?.email || authEmailByUser.get(member.user_id) || "",
    };
  });

  const courseById = Object.fromEntries(
    allReferencedCourses.map((course) => [course.id, course]),
  );
  return NextResponse.json(
    {
      context: organizationContextForClient(context),
      liveCoursesEnabled,
      generatedAt: new Date().toISOString(),
      members: memberDetails,
      invitations: invitationResult.data ?? [],
      seatLots: (lotResult.data ?? []).map((lot) => ({
        ...lot,
        course: courseById[lot.course_id] ?? null,
      })),
      allocations: (allocationResult.data ?? []).map((allocation) => ({
        ...allocation,
        course: courseById[allocation.course_id] ?? null,
      })),
      seatEvents: seatEventResult.data ?? [],
      orders: orderResult.data ?? [],
      orderItems: orderItemResult.data ?? [],
      invoices: invoiceResult.data ?? [],
      refunds: refundResult.data ?? [],
      courses: courseResult.data ?? [],
      reportCourses: allReferencedCourses,
      priceTiers: tierResult.data ?? [],
      liveSessions: [...currentLiveSessions, ...referencedLiveSessions],
      enrollments: enrollmentResult.data ?? [],
      accreditationStatuses: accreditationResult.data ?? [],
      certificates: certificateResult.data ?? [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
