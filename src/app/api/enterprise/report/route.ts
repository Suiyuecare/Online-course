import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canManageOrganization,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  createEnterpriseReportBuffer,
  type EnterpriseAttendanceStatus,
  type EnterpriseCompletionStatus,
  type EnterpriseCourseDelivery,
  type EnterpriseEmployeeOutcomeRow,
  type EnterpriseLiveAttendanceRow,
  type EnterpriseSeatEventType,
  type EnterpriseSeatLedgerRow,
  type EnterpriseTrainingSummaryRow,
} from "@/lib/enterprise-spreadsheet";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const querySchema = z.object({
  organizationId: z.string().uuid(),
  courseId: z.string().uuid().optional(),
  liveSessionId: z.string().uuid().optional(),
  department: z.string().trim().max(100).optional(),
  completionStatus: z
    .enum(["not_started", "in_progress", "completed", "expired"])
    .optional(),
});

type DbRow = Record<string, unknown>;

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rowId(row: DbRow, key = "id") {
  return asText(row[key]);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchOrganizationRows(
  admin: SupabaseClient,
  table: string,
  organizationId: string,
  orderKey: string,
  columns = "*",
) {
  const rows: DbRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId)
      .order(orderKey)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as DbRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchRowsByIds(
  admin: SupabaseClient,
  table: string,
  columns: string,
  key: string,
  ids: string[],
) {
  const rows: DbRow[] = [];
  await inChunks(unique(ids), 100, async (chunk) => {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .in(key, chunk)
        .order(key)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as unknown as DbRow[]));
      if (!data || data.length < pageSize) break;
    }
  });
  return rows;
}

async function inChunks<T>(
  values: T[],
  size: number,
  worker: (chunk: T[]) => Promise<void>,
) {
  for (let index = 0; index < values.length; index += size)
    await worker(values.slice(index, index + size));
}

async function attendanceRows(
  admin: SupabaseClient,
  bookingIds: string[],
) {
  const rows = new Map<string, DbRow>();
  const summaries = await fetchRowsByIds(
    admin,
    "live_attendance_summaries",
    "booking_id,checked_in_at,checked_out_at,camera_percent,attendance_status",
    "booking_id",
    bookingIds,
  );
  for (const row of summaries) rows.set(asText(row.booking_id), row);
  return rows;
}

function completionStatus(
  allocation: DbRow,
  enrollment?: DbRow,
): EnterpriseCompletionStatus {
  if (enrollment?.status === "completed") return "completed";
  const dueAt = asText(allocation.due_at);
  if (
    allocation.status === "expired" ||
    (dueAt && Date.parse(dueAt) < Date.now())
  )
    return "expired";
  if (
    allocation.status === "consumed" ||
    asNumber(enrollment?.progress_percent) > 0 ||
    Boolean(enrollment?.started_at)
  )
    return "in_progress";
  return "not_started";
}

function attendanceStatus(value: unknown): EnterpriseAttendanceStatus {
  if (value === "qualified") return "qualified";
  if (value === "disqualified") return "disqualified";
  if (["pending", "needs_review"].includes(String(value))) return "pending_review";
  return "not_started";
}

function seatEventType(value: unknown): EnterpriseSeatEventType | null {
  return [
    "available",
    "assigned",
    "consumed",
    "released",
    "expired",
    "refunded",
    "correction",
  ].includes(String(value))
    ? (value as EnterpriseSeatEventType)
    : null;
}

export async function GET(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(searchParams);
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REPORT_FILTERS" }, { status: 400 });

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
    parsed.data.organizationId,
  );
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

  let members: DbRow[];
  let lots: DbRow[];
  let allocations: DbRow[];
  let enrollments: DbRow[];
  let acceptedInvitations: DbRow[];
  try {
    [members, lots, allocations, enrollments, acceptedInvitations] =
      await Promise.all([
      fetchOrganizationRows(
        admin,
        "organization_members",
        context.organizationId,
        "user_id",
      ),
      fetchOrganizationRows(
        admin,
        "enterprise_seat_lots",
        context.organizationId,
        "id",
      ),
      fetchOrganizationRows(
        admin,
        "enterprise_seat_allocations",
        context.organizationId,
        "id",
      ),
      fetchOrganizationRows(
        admin,
        "enrollments",
        context.organizationId,
        "id",
      ),
      fetchOrganizationRows(
        admin,
        "organization_invitations",
        context.organizationId,
        "accepted_by",
        "accepted_by,email,invitee_name,status",
      ),
    ]);
  } catch {
    return NextResponse.json({ error: "REPORT_QUERY_FAILED" }, { status: 503 });
  }

  const learnerIds = unique([
    ...members.map((member) => asText(member.user_id)),
    ...allocations.map((allocation) => asText(allocation.learner_id)),
    ...enrollments.map((enrollment) => asText(enrollment.learner_id)),
  ]);
  const courseIds = unique([
    ...lots.map((lot) => asText(lot.course_id)),
    ...allocations.map((allocation) => asText(allocation.course_id)),
    ...enrollments.map((enrollment) => asText(enrollment.course_id)),
  ]);
  const sessionIds = unique([
    ...allocations.map((allocation) => asText(allocation.live_session_id)),
    ...enrollments.map((enrollment) => asText(enrollment.live_session_id)),
  ]);
  const enrollmentIds = unique(
    enrollments.map((enrollment) => rowId(enrollment)),
  );
  const bookingIds = unique(
    allocations.map((allocation) => asText(allocation.booking_id)),
  );
  const lotIds = unique(lots.map((lot) => rowId(lot)));

  let profiles: DbRow[];
  let courses: DbRow[];
  let sessions: DbRow[];
  let certificates: DbRow[];
  let events: DbRow[];
  let attendanceByBooking: Map<string, DbRow>;
  try {
    [profiles, courses, sessions, certificates, events, attendanceByBooking] =
      await Promise.all([
        fetchRowsByIds(admin, "profiles", "id,full_name", "id", learnerIds),
        fetchRowsByIds(
          admin,
          "courses",
          "id,title,delivery",
          "id",
          courseIds,
        ),
        fetchRowsByIds(
          admin,
          "live_sessions",
          "id,course_id,title,starts_at,ends_at",
          "id",
          sessionIds,
        ),
        fetchRowsByIds(
          admin,
          "certificates",
          "enrollment_id,verification_code,revoked_at",
          "enrollment_id",
          enrollmentIds,
        ),
        fetchRowsByIds(
          admin,
          "enterprise_seat_events",
          "id,seat_lot_id,allocation_id,event_type,quantity,available_delta,actor_id,metadata,occurred_at",
          "seat_lot_id",
          lotIds,
        ),
        attendanceRows(admin, bookingIds),
      ]);
  } catch {
    return NextResponse.json({ error: "REPORT_RELATION_QUERY_FAILED" }, { status: 503 });
  }

  const acceptedInvitationByUser = new Map(
    acceptedInvitations.flatMap((invitation) => {
      const userId = asText(invitation.accepted_by);
      return invitation.status === "accepted" && userId
        ? ([[userId, invitation]] as const)
        : [];
    }),
  );
  const emailsByUser = new Map(
    [...acceptedInvitationByUser].flatMap(([userId, invitation]) => {
      const email = asText(invitation.email).trim().toLowerCase();
      return email ? ([[userId, email]] as const) : [];
    }),
  );
  const legacyMembers = members.filter(
    (member) => !emailsByUser.has(asText(member.user_id)),
  );
  try {
    await inChunks(legacyMembers, 20, async (chunk) => {
      const results = await Promise.all(
        chunk.map((member) =>
          admin.auth.admin.getUserById(asText(member.user_id)),
        ),
      );
      for (let index = 0; index < results.length; index += 1) {
        if (results[index].error) throw results[index].error;
        const email = results[index].data.user?.email?.trim().toLowerCase();
        if (email) emailsByUser.set(asText(chunk[index].user_id), email);
      }
    });
  } catch {
    return NextResponse.json({ error: "REPORT_MEMBER_LOOKUP_FAILED" }, { status: 503 });
  }

  const profileByUser = new Map(profiles.map((row) => [rowId(row), row]));
  const invitationNameByUser = new Map(
    [...acceptedInvitationByUser].flatMap(([userId, invitation]) => {
      const name = asText(invitation.invitee_name).trim();
      return name ? ([[userId, name]] as const) : [];
    }),
  );
  const memberByUser = new Map(members.map((row) => [asText(row.user_id), row]));
  const courseById = new Map(courses.map((row) => [rowId(row), row]));
  const sessionById = new Map(sessions.map((row) => [rowId(row), row]));
  const lotById = new Map(lots.map((row) => [rowId(row), row]));
  const enrollmentById = new Map(enrollments.map((row) => [rowId(row), row]));
  const enrollmentByAllocation = new Map(
    allocations.flatMap((allocation) => {
      const enrollment = enrollmentById.get(asText(allocation.enrollment_id));
      return enrollment ? [[rowId(allocation), enrollment] as const] : [];
    }),
  );
  const allocationById = new Map(
    allocations.map((row) => [rowId(row), row]),
  );
  const certificateEnrollmentIds = new Set(
    certificates
      .filter((certificate) => !certificate.revoked_at)
      .map((certificate) => asText(certificate.enrollment_id)),
  );

  const courseIdForAllocation = (allocation: DbRow) =>
    asText(allocation.course_id) ||
    asText(lotById.get(asText(allocation.seat_lot_id))?.course_id);
  const memberDetails = (learnerId: string) => ({
    member: memberByUser.get(learnerId),
    name:
      asText(profileByUser.get(learnerId)?.full_name).trim() ||
      invitationNameByUser.get(learnerId) ||
      "",
    email: emailsByUser.get(learnerId) ?? "",
  });
  const matchesCommonFilters = (
    allocation: DbRow,
    status: EnterpriseCompletionStatus,
  ) => {
    const courseId = courseIdForAllocation(allocation);
    const learnerId = asText(allocation.learner_id);
    const department = asText(memberByUser.get(learnerId)?.department);
    return (
      (!parsed.data.courseId || courseId === parsed.data.courseId) &&
      (!parsed.data.liveSessionId ||
        asText(allocation.live_session_id) === parsed.data.liveSessionId) &&
      (!parsed.data.department || department === parsed.data.department) &&
      (!parsed.data.completionStatus || status === parsed.data.completionStatus)
    );
  };

  const activeAllocations = allocations.filter(
    (allocation) => !["released", "refunded"].includes(asText(allocation.status)),
  );
  const employeeOutcomes: EnterpriseEmployeeOutcomeRow[] = activeAllocations
    .flatMap((allocation) => {
      const enrollment =
        enrollmentByAllocation.get(rowId(allocation)) ??
        enrollments.find(
          (row) =>
            row.learner_id === allocation.learner_id &&
            row.course_id === courseIdForAllocation(allocation) &&
            (row.live_session_id ?? null) ===
              (allocation.live_session_id ?? null),
        );
      const status = completionStatus(allocation, enrollment);
      if (!matchesCommonFilters(allocation, status)) return [];
      const learnerId = asText(allocation.learner_id);
      const details = memberDetails(learnerId);
      const course = courseById.get(courseIdForAllocation(allocation));
      const session = sessionById.get(asText(allocation.live_session_id));
      const delivery = asText(course?.delivery) as EnterpriseCourseDelivery;
      if (!course || !["recorded", "live"].includes(delivery)) return [];
      return [
        {
          name: details.name,
          email: details.email,
          employeeNumber: asText(details.member?.employee_code),
          department: asText(details.member?.department),
          courseTitle: asText(course.title),
          delivery,
          liveSessionTitle: asText(session?.title) || undefined,
          assignedAt:
            asText(allocation.assigned_at),
          deadline: asText(allocation.due_at) || undefined,
          progressRate: asNumber(enrollment?.progress_percent) / 100,
          quizStatus: enrollment?.quiz_passed ? "completed" : "pending",
          satisfactionStatus: enrollment?.satisfaction_completed
            ? "completed"
            : "pending",
          certificateStatus:
            enrollment && certificateEnrollmentIds.has(rowId(enrollment))
              ? "completed"
              : "pending",
          completionStatus: status,
        } satisfies EnterpriseEmployeeOutcomeRow,
      ];
    })
    .sort(
      (left, right) =>
        left.courseTitle.localeCompare(right.courseTitle, "zh-TW") ||
        (left.department ?? "").localeCompare(right.department ?? "", "zh-TW") ||
        (left.name ?? left.email).localeCompare(right.name ?? right.email, "zh-TW"),
    );

  const liveAttendances: EnterpriseLiveAttendanceRow[] = activeAllocations
    .flatMap((allocation) => {
      const sessionId = asText(allocation.live_session_id);
      if (!sessionId) return [];
      const enrollment = enrollmentByAllocation.get(rowId(allocation));
      const status = completionStatus(allocation, enrollment);
      if (!matchesCommonFilters(allocation, status)) return [];
      const learnerId = asText(allocation.learner_id);
      const details = memberDetails(learnerId);
      const course = courseById.get(courseIdForAllocation(allocation));
      const session = sessionById.get(sessionId);
      if (!course || !session) return [];
      const attendance = attendanceByBooking.get(
        asText(allocation.booking_id),
      );
      return [
        {
          name: details.name,
          email: details.email,
          employeeNumber: asText(details.member?.employee_code),
          department: asText(details.member?.department),
          courseTitle: asText(course.title),
          liveSessionTitle: asText(session.title),
          startsAt: asText(session.starts_at),
          checkedInAt: asText(attendance?.checked_in_at) || undefined,
          checkedOutAt: asText(attendance?.checked_out_at) || undefined,
          cameraRate: asNumber(attendance?.camera_percent) / 100,
          attendanceStatus: attendanceStatus(attendance?.attendance_status),
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(left.startsAt.toString()) - Date.parse(right.startsAt.toString()) ||
        (left.name ?? left.email).localeCompare(right.name ?? right.email, "zh-TW"),
    );

  const relevantCourseIds = unique([
    ...lots
      .filter(
        (lot) =>
          !parsed.data.courseId || lot.course_id === parsed.data.courseId,
      )
      .map((lot) => asText(lot.course_id)),
    ...activeAllocations
      .filter((allocation) => {
        const status = completionStatus(
          allocation,
          enrollmentByAllocation.get(rowId(allocation)),
        );
        return matchesCommonFilters(allocation, status);
      })
      .map(courseIdForAllocation),
    ...(parsed.data.liveSessionId
      ? [asText(sessionById.get(parsed.data.liveSessionId)?.course_id)]
      : []),
  ]);
  if (parsed.data.courseId && !relevantCourseIds.includes(parsed.data.courseId))
    relevantCourseIds.push(parsed.data.courseId);
  const trainingSummaries: EnterpriseTrainingSummaryRow[] = relevantCourseIds
    .flatMap((courseId) => {
      const course = courseById.get(courseId);
      const delivery = asText(course?.delivery) as EnterpriseCourseDelivery;
      if (!course || !["recorded", "live"].includes(delivery)) return [];
      const courseLots = lots.filter((lot) => asText(lot.course_id) === courseId);
      const courseAllocations = activeAllocations.filter(
        (allocation) => {
          const status = completionStatus(
            allocation,
            enrollmentByAllocation.get(rowId(allocation)),
          );
          return (
            courseIdForAllocation(allocation) === courseId &&
            matchesCommonFilters(allocation, status)
          );
        },
      );
      const purchasedSeats = courseLots.reduce(
        (sum, lot) =>
          sum + asNumber(lot.total_quantity),
        0,
      );
      const availableSeats = courseLots.reduce(
        (sum, lot) => sum + asNumber(lot.available_quantity),
        0,
      );
      const assignedSeats = courseAllocations.filter(
        (allocation) => allocation.status === "assigned",
      ).length;
      const consumedSeats = courseAllocations.filter(
        (allocation) => allocation.status === "consumed",
      ).length;
      const completedLearners = courseAllocations.filter(
        (allocation) =>
          enrollmentByAllocation.get(rowId(allocation))?.status === "completed",
      ).length;
      const denominator = assignedSeats + consumedSeats;
      return [
        {
          courseTitle: asText(course.title),
          delivery,
          liveSessionTitle: parsed.data.liveSessionId
            ? asText(sessionById.get(parsed.data.liveSessionId)?.title)
            : undefined,
          purchasedSeats,
          availableSeats,
          assignedSeats,
          consumedSeats,
          completedLearners,
          completionRate: denominator ? completedLearners / denominator : 0,
        },
      ];
    })
    .sort((left, right) => left.courseTitle.localeCompare(right.courseTitle, "zh-TW"));

  const seatLedgerEvents: EnterpriseSeatLedgerRow[] = events
    .flatMap((event) => {
      const eventType = seatEventType(event.event_type);
      if (!eventType) return [];
      const allocation = allocationById.get(asText(event.allocation_id));
      const lot = lotById.get(
        asText(event.seat_lot_id) || asText(allocation?.seat_lot_id),
      );
      const courseId =
        asText(event.course_id) ||
        asText(lot?.course_id) ||
        (allocation ? courseIdForAllocation(allocation) : "");
      const learnerId = asText(allocation?.learner_id);
      const details = memberDetails(learnerId);
      if (parsed.data.courseId && courseId !== parsed.data.courseId) return [];
      const hasAllocationFilter = Boolean(
        parsed.data.liveSessionId ||
          parsed.data.department ||
          parsed.data.completionStatus,
      );
      if (hasAllocationFilter && !allocation) return [];
      if (allocation) {
        const status = completionStatus(
          allocation,
          enrollmentByAllocation.get(rowId(allocation)),
        );
        if (!matchesCommonFilters(allocation, status)) return [];
      }
      const course = courseById.get(courseId);
      const session = sessionById.get(asText(allocation?.live_session_id));
      return [
        {
          occurredAt: asText(event.occurred_at) || asText(event.created_at),
          courseTitle: asText(course?.title) || "未識別課程",
          batchLabel:
            lot ? rowId(lot).slice(0, 8) : undefined,
          eventType,
          quantityDelta: asNumber(event.available_delta),
          employeeName: details.name || undefined,
          liveSessionTitle: asText(session?.title) || undefined,
          reason:
            asText((event.metadata as DbRow | undefined)?.reason) || undefined,
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt.toString()) -
        Date.parse(right.occurredAt.toString()),
    );

  const buffer = await createEnterpriseReportBuffer({
    organization: {
      name: context.organization.name,
      taxId: context.organization.tax_id ?? undefined,
    },
    generatedAt: new Date(),
    filters: {
      courseTitle: parsed.data.courseId
        ? asText(courseById.get(parsed.data.courseId)?.title)
        : undefined,
      liveSessionTitle: parsed.data.liveSessionId
        ? asText(sessionById.get(parsed.data.liveSessionId)?.title)
        : undefined,
      department: parsed.data.department,
      completionStatus: parsed.data.completionStatus,
    },
    trainingSummaries,
    employeeOutcomes,
    liveAttendances,
    seatLedgerEvents,
  });
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const { error: auditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "enterprise.report_exported",
    target_type: "organization",
    target_id: context.organizationId,
    after_data: {
      employee_rows: employeeOutcomes.length,
      live_rows: liveAttendances.length,
      seat_event_rows: seatLedgerEvents.length,
      checksum,
      filters: parsed.data,
    },
  });
  if (auditError)
    return NextResponse.json(
      { error: "REPORT_AUDIT_FAILED" },
      { status: 503 },
    );

  const date = new Date().toISOString().slice(0, 10);
  return new Response(buffer as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''suiyue-enterprise-report-${date}.xlsx`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
