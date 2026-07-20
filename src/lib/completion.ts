import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEnterpriseCompletionNotification } from "@/lib/enterprise-learning";

export async function maybeCompleteEnrollment(
  admin: SupabaseClient,
  enrollmentId: string,
) {
  const { data: enrollment } = await admin
    .from("enrollments")
    .select(
      "id,learner_id,course_id,live_session_id,status,valid_watch_seconds,quiz_passed,satisfaction_completed",
    )
    .eq("id", enrollmentId)
    .single();
  if (!enrollment) return { completed: false as const };
  const { data: course } = await admin
    .from("courses")
    .select(
      "delivery,completion_percent,satisfaction_required,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority",
    )
    .eq("id", enrollment.course_id)
    .single();
  const { data: modules } = await admin
    .from("course_modules")
    .select("id")
    .eq("course_id", enrollment.course_id);
  const moduleIds = modules?.map((module) => module.id) ?? [];
  const { data: lessons } = moduleIds.length
    ? await admin
        .from("lessons")
        .select("duration_seconds,is_preview")
        .in("module_id", moduleIds)
    : { data: [] };
  const duration =
    lessons
      ?.filter((lesson) => !lesson.is_preview)
      .reduce((sum, lesson) => sum + lesson.duration_seconds, 0) ?? 0;
  const watched =
    duration > 0 &&
    enrollment.valid_watch_seconds >=
      Math.ceil((duration * (course?.completion_percent ?? 90)) / 100);
  const { data: liveBooking } = enrollment.live_session_id
    ? await admin
        .from("live_session_bookings")
        .select("id")
        .eq("live_session_id", enrollment.live_session_id)
        .eq("learner_id", enrollment.learner_id)
        .eq("enrollment_id", enrollment.id)
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const { data: liveSummary } = liveBooking
    ? await admin
        .from("live_attendance_summaries")
        .select("attendance_status,camera_percent")
        .eq("booking_id", liveBooking.id)
        .maybeSingle()
    : { data: null };
  const attendanceQualified =
    course?.delivery === "live"
      ? liveSummary?.attendance_status === "qualified"
      : watched;
  const complete =
    attendanceQualified &&
    enrollment.quiz_passed &&
    (!course?.satisfaction_required || enrollment.satisfaction_completed);
  if (!complete)
    return {
      completed: false as const,
      watched,
      attendanceQualified,
      quizPassed: enrollment.quiz_passed,
      satisfactionCompleted: enrollment.satisfaction_completed,
    };
  const newlyCompleted = enrollment.status !== "completed";
  if (newlyCompleted)
    await admin
      .from("enrollments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress_percent: 100,
        final_result: "passed",
      })
      .eq("id", enrollment.id);
  if (newlyCompleted)
    await sendEnterpriseCompletionNotification(admin, enrollment.id).catch(
      () => undefined,
    );
  if (course?.accredited) {
    const { data: registration } = await admin
      .from("accreditation_registrations")
      .select("status")
      .eq("enrollment_id", enrollment.id)
      .maybeSingle();
    const approved =
      course.accreditation_status === "approved" &&
      Boolean(course.accreditation_number) &&
      Number(course.accreditation_points) > 0;
    if (!approved || registration?.status !== "verified") {
      return {
        completed: true as const,
        certificatePending: true as const,
        registrationStatus: registration?.status ?? null,
      };
    }
  }
  const { data: existing } = await admin
    .from("certificates")
    .select("verification_code")
    .eq("enrollment_id", enrollment.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (existing)
    return {
      completed: true as const,
      verificationCode: existing.verification_code,
    };
  const { data: liveSession } = enrollment.live_session_id
    ? await admin
        .from("live_sessions")
        .select("starts_at,camera_required_percent")
        .eq("id", enrollment.live_session_id)
        .maybeSingle()
    : { data: null };
  const certificatePayload = course?.accredited
    ? {
        enrollment_id: enrollment.id,
        learner_id: enrollment.learner_id,
        certificate_kind: "accreditation",
        accreditation_number_snapshot: course.accreditation_number,
        accreditation_points_snapshot: course.accreditation_points,
        accreditation_authority_snapshot: course.accreditation_authority,
        live_session_id: enrollment.live_session_id,
        live_session_date_snapshot:
          liveSession?.starts_at?.slice(0, 10) ?? null,
        attendance_threshold_snapshot:
          liveSession?.camera_required_percent ?? null,
      }
    : {
        enrollment_id: enrollment.id,
        learner_id: enrollment.learner_id,
        certificate_kind: "completion",
        accreditation_number_snapshot: null,
        accreditation_points_snapshot: null,
        accreditation_authority_snapshot: null,
        live_session_id: enrollment.live_session_id,
        live_session_date_snapshot:
          liveSession?.starts_at?.slice(0, 10) ?? null,
        attendance_threshold_snapshot:
          liveSession?.camera_required_percent ?? null,
      };
  const { data: certificate, error } = await admin
    .from("certificates")
    .insert(certificatePayload)
    .select("verification_code")
    .single();
  if (error || !certificate) return { completed: true as const };
  await admin
    .from("audit_events")
    .insert({
      actor_id: enrollment.learner_id,
      action: "certificate.issued",
      target_type: "enrollment",
      target_id: enrollment.id,
      after_data: { verification_code: certificate.verification_code },
    });
  return {
    completed: true as const,
    verificationCode: certificate.verification_code,
  };
}
