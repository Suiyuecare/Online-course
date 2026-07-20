import Link from "next/link";
import {
  AccreditationReviewTable,
  type AccreditationReviewRow,
} from "@/components/accreditation-review-table";
import { DashboardHeader } from "@/components/site-header";
import { accreditationQualification } from "@/lib/accreditation";
import {
  createSupabaseAdminClient,
  getPlatformRole,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

const previewRows: AccreditationReviewRow[] = [
  {
    id: "preview",
    learner: "示範學員",
    course: "正式積分錄播課（樣張）",
    maskedId: "A1*****89",
    category: "照顧服務人員",
    status: "submitted",
    progress: 82,
    quizPassed: true,
    satisfactionCompleted: true,
    reasons: ["積分身分資料尚未驗證", "有效觀看未達 90%"],
  },
];

export default async function AdminAccreditationPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const selectedCourseId = (await searchParams).courseId ?? "";
  const role = await getPlatformRole();
  const preview = !isSupabaseConfigured();
  const admin = !preview ? createSupabaseAdminClient() : null;
  let rows: AccreditationReviewRow[] = preview ? previewRows : [];
  let accreditedCourses: {
    id: string;
    title: string;
    accreditation_number: string | null;
  }[] = preview
    ? [
        {
          id: "preview-course",
          title: "正式積分錄播課（樣張）",
          accreditation_number: "樣張",
        },
      ]
    : [];
  if (admin && ["admin", "support"].includes(role)) {
    const { data: availableCourses } = await admin
      .from("courses")
      .select("id,title,accreditation_number")
      .eq("accredited", true)
      .order("created_at", { ascending: false });
    accreditedCourses = availableCourses ?? [];
    if (
      selectedCourseId &&
      accreditedCourses.some((course) => course.id === selectedCourseId)
    ) {
      const { data: registrations } = await admin
        .from("accreditation_registrations")
        .select(
          "id,learner_id,course_id,status,personnel_category,national_id_masked,enrollment_id",
        )
        .eq("course_id", selectedCourseId)
        .order("updated_at", { ascending: false });
      const learnerIds = [
        ...new Set((registrations ?? []).map((item) => item.learner_id)),
      ];
      const enrollmentIds = (registrations ?? []).map(
        (item) => item.enrollment_id,
      );
      const [{ data: profiles }, { data: course }, { data: enrollments }] =
        await Promise.all([
          learnerIds.length
            ? admin.from("profiles").select("id,full_name").in("id", learnerIds)
            : Promise.resolve({ data: [] }),
          admin
            .from("courses")
            .select(
              "id,title,accreditation_status,accreditation_number,accreditation_points,completion_percent,satisfaction_required",
            )
            .eq("id", selectedCourseId)
            .single(),
          enrollmentIds.length
            ? admin
                .from("enrollments")
                .select(
                  "id,status,progress_percent,quiz_passed,satisfaction_completed",
                )
                .in("id", enrollmentIds)
            : Promise.resolve({ data: [] }),
        ]);
      rows = (registrations ?? []).map((registration) => {
        const profile = profiles?.find(
          (item) => item.id === registration.learner_id,
        );
        const enrollment = enrollments?.find(
          (item) => item.id === registration.enrollment_id,
        );
        const check = accreditationQualification({
          courseApproved:
            course?.accreditation_status === "approved" &&
            Boolean(course?.accreditation_number) &&
            Number(course?.accreditation_points) > 0,
          registrationStatus: registration.status,
          progressPercent: enrollment?.progress_percent ?? 0,
          completionPercent: course?.completion_percent ?? 90,
          quizPassed: enrollment?.quiz_passed ?? false,
          satisfactionCompleted: enrollment?.satisfaction_completed ?? false,
          satisfactionRequired: course?.satisfaction_required ?? true,
          enrollmentStatus: enrollment?.status ?? "active",
        });
        return {
          id: registration.id,
          learner: profile?.full_name || "未填姓名",
          course: course?.title || "課程",
          maskedId: registration.national_id_masked,
          category: registration.personnel_category,
          status: registration.status,
          progress: enrollment?.progress_percent ?? 0,
          quizPassed: enrollment?.quiz_passed ?? false,
          satisfactionCompleted: enrollment?.satisfaction_completed ?? false,
          reasons: check.reasons,
        };
      });
    }
  }
  const effectiveCourseId = preview ? "preview-course" : selectedCourseId;
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <Link href="/admin" className="text-sm font-black text-[#B45309]">
          ← 回到後台首頁
        </Link>
        <div className="mt-5">
          <p className="section-kicker">ACCREDITATION DESK</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            積分送審工作台
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            先選擇一門核定課程，再審核與匯出；每份 Excel 只會包含同一核定字號。
          </p>
        </div>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="選擇積分課程">
          {accreditedCourses.map((course) => (
            <Link
              key={course.id}
              href={
                preview
                  ? "/admin/accreditation"
                  : `/admin/accreditation?courseId=${course.id}`
              }
              className={`min-h-11 rounded-full border px-4 py-2.5 text-sm font-black ${effectiveCourseId === course.id ? "border-[#B45309] bg-[#B45309] text-white" : "border-[#EADFCF] bg-white text-[#57483A]"}`}
            >
              {course.title}
              {course.accreditation_number
                ? `・${course.accreditation_number}`
                : "・尚未核定"}
            </Link>
          ))}
        </nav>
        {!effectiveCourseId && (
          <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">
            請先選擇一門積分課程，才會載入學員資料。
          </div>
        )}
        <div className="mt-7">
          <AccreditationReviewTable
            rows={rows}
            enabled={role === "admin" && !preview}
            courseId={effectiveCourseId}
          />
        </div>
      </main>
    </div>
  );
}
