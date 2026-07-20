import { Resend } from "resend";
import "server-only";
import { LiveCourseEmail } from "@/emails/live-course-email";
import { appOrigin } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type LiveEmailKind =
  | "purchase_confirmation"
  | "reminder_24h"
  | "reminder_1h";
let resendClient: Resend | null = null;
function resend() {
  if (!process.env.RESEND_API_KEY) return null;
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendLiveCourseEmail(
  bookingId: string,
  kind: LiveEmailKind,
  request?: Request,
) {
  const client = resend();
  const admin = createSupabaseAdminClient();
  if (!client || !admin)
    return { sent: false as const, reason: "EMAIL_NOT_CONFIGURED" };
  const { data: booking } = await admin
    .from("live_session_bookings")
    .select(
      "id,learner_id,status,live_sessions(id,title,starts_at,courses(title))",
    )
    .eq("id", bookingId)
    .maybeSingle();
  const session =
    booking &&
    (Array.isArray(booking.live_sessions)
      ? booking.live_sessions[0]
      : booking.live_sessions);
  const course =
    session &&
    (Array.isArray(session.courses) ? session.courses[0] : session.courses);
  if (!booking || booking.status !== "confirmed" || !session || !course)
    return { sent: false as const, reason: "BOOKING_NOT_CONFIRMED" };
  const { data: existing } = await admin
    .from("live_email_deliveries")
    .select("id,status")
    .eq("booking_id", booking.id)
    .eq("kind", kind)
    .maybeSingle();
  if (existing?.status === "sent")
    return { sent: true as const, duplicate: true };
  let deliveryId = existing?.id;
  if (!deliveryId) {
    const { data: created } = await admin
      .from("live_email_deliveries")
      .insert({ booking_id: booking.id, kind, status: "pending" })
      .select("id")
      .single();
    deliveryId = created?.id;
  }
  if (!deliveryId)
    return { sent: false as const, reason: "DELIVERY_LOCK_FAILED" };
  const [{ data: user }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(booking.learner_id),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", booking.learner_id)
      .maybeSingle(),
  ]);
  if (!user.user?.email)
    return { sent: false as const, reason: "LEARNER_EMAIL_MISSING" };
  const from =
    process.env.RESEND_FROM_EMAIL ?? "歲悅學苑 <onboarding@resend.dev>";
  const subject =
    kind === "purchase_confirmation"
      ? `購課成功｜${course.title}`
      : kind === "reminder_24h"
        ? `課前提醒｜${course.title} 將於 24 小時內開始`
        : `即將上課｜${course.title} 將於 1 小時內開始`;
  const result = await client.emails.send(
    {
      from,
      to: user.user.email,
      subject,
      react: (
        <LiveCourseEmail
          learnerName={profile?.full_name?.trim() || "學員"}
          courseTitle={course.title}
          sessionTitle={session.title}
          startsAt={session.starts_at}
          classroomUrl={`${appOrigin(request)}/live/${session.id}`}
          kind={kind}
        />
      ),
    },
    { headers: { "Idempotency-Key": `live-${kind}-${booking.id}` } },
  );
  if (result.error) {
    await admin
      .from("live_email_deliveries")
      .update({ status: "failed", error_message: result.error.message })
      .eq("id", deliveryId);
    return { sent: false as const, reason: result.error.message };
  }
  await admin
    .from("live_email_deliveries")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: result.data?.id ?? null,
      error_message: null,
    })
    .eq("id", deliveryId);
  return { sent: true as const };
}

export async function sendLiveCourseEmailByOrder(
  orderId: string,
  kind: LiveEmailKind,
  request?: Request,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { sent: false as const, reason: "SERVICE_NOT_CONFIGURED" };
  const { data: booking } = await admin
    .from("live_session_bookings")
    .select("id")
    .eq("source_order_id", orderId)
    .eq("status", "confirmed")
    .maybeSingle();
  return booking
    ? sendLiveCourseEmail(booking.id, kind, request)
    : { sent: false as const, reason: "NOT_A_LIVE_ORDER" };
}
