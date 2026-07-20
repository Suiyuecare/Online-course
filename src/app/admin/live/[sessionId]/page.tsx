import Link from "next/link";
import { notFound } from "next/navigation";
import {
  LiveAttendanceReview,
  type ReviewRow,
  type TransferTarget,
} from "@/components/live-attendance-review";
import { DashboardHeader } from "@/components/site-header";
import {
  createSupabaseAdminClient,
  getPlatformRole,
} from "@/lib/supabase/server";

export default async function LiveReviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const role = await getPlatformRole();
  if (!(["admin", "support"] as string[]).includes(role)) notFound();
  const admin = createSupabaseAdminClient();
  if (!admin) notFound();
  const { sessionId } = await params;
  const { data: session } = await admin
    .from("live_sessions")
    .select(
      "id,course_id,title,starts_at,ends_at,status,courses(title,accredited)",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) notFound();
  const [{ data: bookings }, { data: future }] = await Promise.all([
    admin
      .from("live_session_bookings")
      .select(
        "id,learner_id,enrollment_id,status,live_attendance_summaries(checked_in_at,checked_out_at,camera_percent,attendance_status,reasons)",
      )
      .eq("live_session_id", sessionId)
      .in("status", ["confirmed", "cancelled", "refunded"])
      .order("created_at"),
    admin
      .from("live_sessions")
      .select("id,title,starts_at,capacity,live_session_bookings(status)")
      .eq("course_id", session.course_id)
      .neq("id", sessionId)
      .in("status", ["scheduled", "open"])
      .gt("starts_at", new Date().toISOString())
      .order("starts_at"),
  ]);
  const learnerIds = [
    ...new Set((bookings ?? []).map((item) => item.learner_id)),
  ];
  const enrollmentIds = (bookings ?? []).flatMap((item) =>
    item.enrollment_id ? [item.enrollment_id] : [],
  );
  const [{ data: profiles }, { data: registrations }] = await Promise.all([
    learnerIds.length
      ? admin.from("profiles").select("id,full_name").in("id", learnerIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("accreditation_registrations")
          .select("enrollment_id,status")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] }),
  ]);
  const rows: ReviewRow[] = (bookings ?? []).map((booking) => {
    const summary = Array.isArray(booking.live_attendance_summaries)
      ? booking.live_attendance_summaries[0]
      : booking.live_attendance_summaries;
    return {
      bookingId: booking.id,
      learnerName:
        profiles?.find((profile) => profile.id === booking.learner_id)
          ?.full_name || "未命名學員",
      bookingStatus: booking.status,
      registrationStatus:
        registrations?.find(
          (registration) =>
            registration.enrollment_id === booking.enrollment_id,
        )?.status ?? "不適用／未填",
      checkedIn: Boolean(summary?.checked_in_at),
      checkedOut: Boolean(summary?.checked_out_at),
      cameraPercent: Number(summary?.camera_percent ?? 0),
      attendanceStatus: summary?.attendance_status ?? "pending",
      reasons: Array.isArray(summary?.reasons)
        ? (summary.reasons as string[])
        : [],
    };
  });
  const targets: TransferTarget[] = (future ?? [])
    .map((target) => ({
      id: target.id,
      title: `${target.title}（${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(target.starts_at))}）`,
      startsAt: target.starts_at,
      remaining: Math.max(
        0,
        target.capacity -
          (target.live_session_bookings?.filter(
            (booking) => booking.status === "confirmed",
          ).length ?? 0),
      ),
    }))
    .filter((target) => target.remaining > 0);
  const course = Array.isArray(session.courses)
    ? session.courses[0]
    : session.courses;
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <Link href="/admin/live" className="text-sm font-black text-[#B45309]">
          ← 回到直播場次
        </Link>
        <div className="mt-5">
          <p className="section-kicker">ATTENDANCE REVIEW</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            {session.title}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {course?.title ?? "同步直播課"}
            ・原始事件不可修改；人工處理只會新增更正與 audit event。
          </p>
          {course?.accredited && (
            <a
              className="button-secondary mt-4 inline-flex"
              href={`/api/exports/accreditation?courseId=${encodeURIComponent(session.course_id)}&liveSessionId=${encodeURIComponent(session.id)}`}
            >
              匯出此場次積分送審 Excel
            </a>
          )}
        </div>
        <div className="mt-7">
          <LiveAttendanceReview
            sessionId={sessionId}
            rows={rows}
            targets={targets}
            editable={role === "admin"}
          />
        </div>
      </main>
    </div>
  );
}
