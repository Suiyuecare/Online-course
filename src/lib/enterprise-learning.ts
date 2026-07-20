import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";

export async function consumeEnterpriseAllocation(
  admin: SupabaseClient,
  actorId: string,
  reference: { enrollmentId?: string; bookingId?: string },
) {
  let query = admin
    .from("enterprise_seat_allocations")
    .select("id,status")
    .eq("learner_id", actorId)
    .in("status", ["assigned", "consumed"]);
  if (reference.enrollmentId)
    query = query.eq("enrollment_id", reference.enrollmentId);
  else if (reference.bookingId)
    query = query.eq("booking_id", reference.bookingId);
  else return { consumed: false as const, reason: "REFERENCE_REQUIRED" };
  const { data: allocation } = await query.maybeSingle();
  if (!allocation)
    return { consumed: false as const, reason: "NO_PENDING_ALLOCATION" };
  if (allocation.status === "consumed")
    return { consumed: true as const, alreadyConsumed: true as const };
  const { error } = await admin.rpc("consume_enterprise_seat", {
    target_allocation_id: allocation.id,
    target_actor_id: actorId,
  });
  return error
    ? { consumed: false as const, reason: error.message }
    : { consumed: true as const };
}

export async function sendEnterpriseCompletionNotification(
  admin: SupabaseClient,
  enrollmentId: string,
) {
  const { data: allocation } = await admin
    .from("enterprise_seat_allocations")
    .select(
      "id,organization_id,learner_id,course_id,organizations(name),courses(title)",
    )
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (!allocation)
    return { sent: false as const, reason: "NOT_ENTERPRISE_ENROLLMENT" };
  const organization = Array.isArray(allocation.organizations)
    ? allocation.organizations[0]
    : allocation.organizations;
  const course = Array.isArray(allocation.courses)
    ? allocation.courses[0]
    : allocation.courses;
  if (!organization || !course)
    return { sent: false as const, reason: "RELATED_DATA_MISSING" };
  const [{ data: user }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(allocation.learner_id),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", allocation.learner_id)
      .maybeSingle(),
  ]);
  if (!user.user?.email)
    return { sent: false as const, reason: "LEARNER_EMAIL_MISSING" };
  return sendEnterpriseEmail({
    kind: "completion",
    to: user.user.email,
    organizationId: allocation.organization_id,
    referenceId: enrollmentId,
    organizationName: organization.name,
    learnerName: profile?.full_name || undefined,
    courseTitle: course.title,
  });
}
