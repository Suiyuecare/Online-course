import Link from "next/link";
import {
  BookOpen,
  CalendarPlus,
  CheckCircle2,
  CirclePlay,
  Clock3,
  FileBadge2,
  Radio,
  ShoppingBag,
  UserRoundCheck,
} from "lucide-react";
import { DashboardHeader } from "@/components/site-header";
import { SignOutButton } from "@/components/sign-out-button";
import { pilotCourse, type Course } from "@/lib/data";
import { mapDatabaseCourse } from "@/lib/course-repository";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

type LearningRow = {
  enrollmentId?: string;
  course: Course;
  status: string;
  progress: number;
  validSeconds: number;
  quizPassed: boolean;
  satisfactionCompleted: boolean;
  certificate?: string;
  registrationStatus?: string;
  organization?: { id: string; name: string };
  organizationDueAt?: string;
  liveSessionId?: string | null;
  liveSession?: {
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    attendance?: string;
    cameraPercent?: number;
  };
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const preview =
    (await searchParams).preview === "1" || !isSupabaseConfigured();
  const userId = preview ? null : await getAuthenticatedUserId();
  const admin = userId ? createSupabaseAdminClient() : null;
  let rows: LearningRow[] = preview
    ? [
        {
          course: pilotCourse,
          status: "preview",
          progress: 0,
          validSeconds: 0,
          quizPassed: false,
          satisfactionCompleted: false,
        },
      ]
    : [];

  if (userId && admin) {
    const { data: enrollments } = await admin
      .from("enrollments")
      .select(
        "id,course_id,organization_id,live_session_id,status,progress_percent,valid_watch_seconds,quiz_passed,satisfaction_completed",
      )
      .eq("learner_id", userId)
      .order("started_at", { ascending: false });
    const courseIds = [
      ...new Set((enrollments ?? []).map((item) => item.course_id)),
    ];
    const liveSessionIds = [
      ...new Set(
        (enrollments ?? []).flatMap((item) =>
          item.live_session_id ? [item.live_session_id] : [],
        ),
      ),
    ];
    const organizationIds = [
      ...new Set(
        (enrollments ?? []).flatMap((item) =>
          item.organization_id ? [item.organization_id] : [],
        ),
      ),
    ];
    const [
      { data: certificates },
      { data: registrations },
      { data: courseRecords },
      { data: liveSessions },
      { data: liveSummaries },
      { data: organizations },
      { data: enterpriseAllocations },
    ] = await Promise.all([
      enrollments?.length
        ? admin
            .from("certificates")
            .select("enrollment_id,verification_code,revoked_at")
            .in(
              "enrollment_id",
              enrollments.map((item) => item.id),
            )
        : Promise.resolve({ data: [] }),
      enrollments?.length
        ? admin
            .from("accreditation_registrations")
            .select("enrollment_id,status")
            .in(
              "enrollment_id",
              enrollments.map((item) => item.id),
            )
        : Promise.resolve({ data: [] }),
      courseIds.length
        ? admin
            .from("courses")
            .select(
              "id,slug,title,subtitle,description,delivery,status,price_twd,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority,pass_score,completion_percent,organizer_name",
            )
            .in("id", courseIds)
        : Promise.resolve({ data: [] }),
      liveSessionIds.length
        ? admin
            .from("live_sessions")
            .select("id,title,starts_at,ends_at,status")
            .in("id", liveSessionIds)
        : Promise.resolve({ data: [] }),
      liveSessionIds.length
        ? admin
            .from("live_attendance_summaries")
            .select("live_session_id,attendance_status,camera_percent")
            .eq("learner_id", userId)
            .in("live_session_id", liveSessionIds)
        : Promise.resolve({ data: [] }),
      organizationIds.length
        ? admin
            .from("organizations")
            .select("id,name")
            .in("id", organizationIds)
        : Promise.resolve({ data: [] }),
      enrollments?.length
        ? admin
            .from("enterprise_seat_allocations")
            .select("enrollment_id,organization_id,due_at")
            .eq("learner_id", userId)
            .in(
              "enrollment_id",
              enrollments.map((item) => item.id),
            )
        : Promise.resolve({ data: [] }),
    ]);
    const learningCourses = await Promise.all(
      (courseRecords ?? []).map((course) => mapDatabaseCourse(course)),
    );
    rows = (enrollments ?? []).flatMap((enrollment) => {
      const course = learningCourses.find(
        (item) => item.id === enrollment.course_id,
      );
      if (!course || !courseIds.includes(enrollment.course_id)) return [];
      const liveSession = liveSessions?.find(
        (item) => item.id === enrollment.live_session_id,
      );
      const liveSummary = liveSummaries?.find(
        (item) => item.live_session_id === enrollment.live_session_id,
      );
      return [
        {
          enrollmentId: enrollment.id,
          course,
          status: enrollment.status,
          progress: enrollment.progress_percent ?? 0,
          validSeconds: enrollment.valid_watch_seconds ?? 0,
          quizPassed: enrollment.quiz_passed ?? false,
          satisfactionCompleted: enrollment.satisfaction_completed ?? false,
          certificate: certificates?.find(
            (item) => item.enrollment_id === enrollment.id && !item.revoked_at,
          )?.verification_code,
          registrationStatus: registrations?.find(
            (item) => item.enrollment_id === enrollment.id,
          )?.status,
          organization: organizations?.find(
            (item) => item.id === enrollment.organization_id,
          ),
          organizationDueAt:
            enterpriseAllocations?.find(
              (item) => item.enrollment_id === enrollment.id,
            )?.due_at ?? undefined,
          liveSessionId: enrollment.live_session_id,
          liveSession: liveSession
            ? {
                ...liveSession,
                attendance: liveSummary?.attendance_status,
                cameraPercent: Number(liveSummary?.camera_percent ?? 0),
              }
            : undefined,
        },
      ];
    });
  }

  const activeRows = rows.filter((row) =>
    ["active", "completed", "preview"].includes(row.status),
  );
  const averageProgress = activeRows.length
    ? Math.round(
        activeRows.reduce((sum, row) => sum + row.progress, 0) /
          activeRows.length,
      )
    : 0;
  const certificateCount = activeRows.filter((row) => row.certificate).length;
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="learner" />
      <main className="dashboard-shell">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker">MY LEARNING</p>
            <h1 className="mt-2 text-3xl font-black text-[#302318]">
              我的學習
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              付款、積分資料、有效觀看、測驗與證明都集中在這裡。
            </p>
          </div>
          {userId && <SignOutButton />}
        </div>
        {preview && (
          <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            目前是預覽模式，不會顯示真實訂單或寫入學習進度。設定 Supabase
            後請登入使用。
          </div>
        )}
        {!preview && !userId && (
          <div className="mt-7 rounded-2xl border border-[#F1D5A8] bg-[#FFF8ED] p-6">
            <h2 className="font-black text-[#302318]">請先登入查看課程</h2>
            <Link className="button-primary mt-4" href="/login?next=/dashboard">
              前往登入
            </Link>
          </div>
        )}
        <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<BookOpen />}
            value={String(activeRows.length)}
            label="已購買課程"
          />
          <Metric
            icon={<Clock3 />}
            value={`${averageProgress}%`}
            label="平均有效觀看進度"
          />
          <Metric
            icon={<CheckCircle2 />}
            value={String(activeRows.filter((row) => row.quizPassed).length)}
            label="已通過測驗"
          />
          <Metric
            icon={<FileBadge2 />}
            value={String(certificateCount)}
            label="已取得證明"
          />
        </section>
        <section className="mt-7 grid gap-5">
          {activeRows.map((row) => (
            <CoursePanel
              key={row.enrollmentId ?? row.course.slug}
              row={row}
              preview={preview}
            />
          ))}
          {!preview && userId && activeRows.length === 0 && (
            <div className="panel p-8 text-center">
              <h2 className="text-xl font-black text-[#302318]">
                還沒有已購買的課程
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                從課程目錄選擇適合你的錄播課。
              </p>
              <Link className="button-primary mt-5" href="/courses">
                <ShoppingBag className="size-5" />
                瀏覽課程
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CoursePanel({ row, preview }: { row: LearningRow; preview: boolean }) {
  const needsRegistration =
    row.course.accredited && row.registrationStatus !== "verified";
  const registrationText = !row.registrationStatus
    ? "尚未填寫"
    : row.registrationStatus === "submitted"
      ? "等待審核"
      : row.registrationStatus === "needs_correction"
        ? "需要補正"
        : row.registrationStatus === "rejected"
          ? "審核不通過"
          : "已驗證";
  const isLive = row.course.delivery === "live" && row.liveSessionId;
  return (
    <article className="panel overflow-hidden">
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-xs font-black text-[#B45309]">
            {isLive ? "同步直播" : row.course.category}・{row.course.duration}・
            {row.course.accredited
              ? `${row.course.accreditationPoints ?? 0} 積分`
              : "非積分"}
          </p>
          <h2 className="mt-2 text-xl font-black text-[#302318]">
            {row.course.title}
          </h2>
          {row.organization && (
            <p className="mt-2 inline-flex rounded-full bg-[#FFF0D5] px-3 py-1.5 text-xs font-black text-[#8A4800]">
              由 {row.organization.name} 指派
              {row.organizationDueAt
                ? `・期限 ${new Intl.DateTimeFormat("zh-TW", {
                    timeZone: "Asia/Taipei",
                    dateStyle: "medium",
                  }).format(new Date(row.organizationDueAt))}`
                : ""}
            </p>
          )}
          {isLive && row.liveSession ? (
            <div className="mt-3 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold text-[#694115]">
              <Radio className="mr-2 inline size-5" />
              {row.liveSession.title}
              <p className="mt-1 pl-7 text-xs text-slate-500">
                {formatLiveDate(
                  row.liveSession.starts_at,
                  row.liveSession.ends_at,
                )}
                ・出席 {row.liveSession.attendance ?? "pending"}・鏡頭{" "}
                {row.liveSession.cameraPercent?.toFixed(1) ?? "0.0"}%
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-500">
                有效觀看 {row.validSeconds} 秒，整體進度 {row.progress}%
              </p>
              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[#FFF0D5]">
                <div
                  className="h-full rounded-full bg-[#EA880C]"
                  style={{ width: `${row.progress}%` }}
                />
              </div>
            </>
          )}
          {row.course.accredited && (
            <p
              className={`mt-3 inline-flex items-center gap-2 text-sm font-bold ${needsRegistration ? "text-amber-800" : "text-emerald-700"}`}
            >
              <UserRoundCheck className="size-4" />
              積分資料：{registrationText}
            </p>
          )}
        </div>
        <div className="grid gap-2 sm:min-w-60">
          {isLive ? (
            <>
              <Link
                className="button-primary"
                href={`/live/${row.liveSessionId}`}
              >
                <Radio className="size-5" />
                設備檢查／加入教室
              </Link>
              <Link
                className="button-secondary"
                href={`/api/live/${row.liveSessionId}/calendar`}
              >
                <CalendarPlus className="size-5" />
                加入行事曆
              </Link>
            </>
          ) : (
            <Link
              className="button-primary"
              href={
                preview
                  ? `/learn/${row.course.slug}?preview=1`
                  : `/learn/${row.course.slug}`
              }
            >
              <CirclePlay className="size-5" />
              {row.progress > 0 ? "繼續上課" : "開始上課"}
            </Link>
          )}
          {row.course.accredited && needsRegistration && (
            <Link
              className="button-secondary"
              href={`/accreditation/${row.course.slug}${row.liveSessionId ? `?session=${row.liveSessionId}` : ""}`}
            >
              填寫／補正積分資料
            </Link>
          )}
          <Link
            className="button-secondary"
            href={`/quiz/${row.course.slug}${row.liveSessionId ? `?session=${row.liveSessionId}` : ""}`}
          >
            課後測驗與滿意度
          </Link>
          {row.certificate && (
            <Link
              className="button-secondary"
              href={`/certificate/${row.certificate}`}
            >
              <FileBadge2 className="size-5" />
              查看{row.course.accredited ? "積分" : "完課"}證明
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
function formatLiveDate(start: string, end: string) {
  return `${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(start))}–${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`;
}
function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="metric-card">
      <span className="text-[#B45309] [&_svg]:size-5">{icon}</span>
      <p className="mt-4 text-2xl font-black text-[#302318]">{value}</p>
      <p className="mt-1 text-xs font-bold text-slate-500">{label}</p>
    </div>
  );
}
