import Link from "next/link";
import { redirect } from "next/navigation";
import { readInstructorDashboard } from "@/application/workspace";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const ratingLabels = ["內容", "講師", "節奏", "實用性", "整體"];

export default async function InstructorPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const { data: isInstructor, error: roleError } = await supabase.rpc(
    "authorize_exact_staff_role",
    { p_required_role: "instructor" },
  );
  if (roleError || typeof isInstructor !== "boolean") {
    return (
      <section className="dashboard-page shell">
        <p className="eyebrow">講師工作台</p>
        <h1>目前無法安全確認講師權限</h1>
        <div className="warning-panel" role="alert">
          <strong>工作台維持關閉</strong>
          <p>
            系統不會把權限服務故障當成「不是講師」，也不會改用管理員資料替代。請稍後重新讀取。
          </p>
        </div>
        <div className="button-row">
          <Link className="button" href="/instructor">
            重新讀取
          </Link>
          <Link className="button secondary" href="/support">
            聯絡客服
          </Link>
        </div>
      </section>
    );
  }
  if (!isInstructor) redirect("/staff/security");

  const dashboard = await readInstructorDashboard(supabase).catch(() => null);
  if (!dashboard) {
    return (
      <section className="dashboard-page shell">
        <p className="eyebrow">講師工作台</p>
        <h1>講師資料目前無法讀取</h1>
        <div className="warning-panel" role="alert">
          <strong>既有課程資料不會以空白畫面代替</strong>
          <p>請稍後重新整理；若持續發生，再請客服協助確認。</p>
        </div>
        <div className="button-row">
          <Link className="button" href="/instructor">
            重新讀取
          </Link>
          <Link className="button secondary" href="/support">
            聯絡客服
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-page shell">
      <p className="eyebrow">講師工作台</p>
      <h1>{dashboard.profile.displayName}</h1>
      <p className="lead">{dashboard.profile.credentials}</p>
      <p>{dashboard.profile.biography}</p>

      <div className="record-list">
        {dashboard.courses.map((course) => (
          <article key={course.courseVersionId}>
            <span>
              v{course.version}・{course.deliveryType}・{course.status}
            </span>
            <h2>{course.title}</h2>
            <h3>相關直播場次</h3>
            {course.liveSessions.length === 0 ? (
              <p>此版本沒有直播場次。</p>
            ) : (
              <ul>
                {course.liveSessions.map((session) => (
                  <li key={session.liveSessionId}>
                    {session.title}：{" "}
                    {new Date(session.startsAt).toLocaleString("zh-TW")}－
                    {new Date(session.endsAt).toLocaleString("zh-TW")}（
                    {session.status}）
                  </li>
                ))}
              </ul>
            )}
            <h3>匿名滿意度彙總</h3>
            <p>有效回覆 {course.surveySummary.responseCount} 份</p>
            {course.surveySummary.averageRatings.length > 0 && (
              <ul>
                {course.surveySummary.averageRatings.map((rating, index) => (
                  <li key={ratingLabels[index] ?? `rating-${index}`}>
                    {ratingLabels[index] ?? `項目 ${index + 1}`}：{rating} / 5
                  </li>
                ))}
              </ul>
            )}
            <p className="closed-note">
              講師工作台只提供匿名數字彙總，不顯示學員姓名或問卷文字。
            </p>
          </article>
        ))}
        {dashboard.courses.length === 0 && (
          <p className="closed-note">目前沒有指派給你的課程版本。</p>
        )}
      </div>
    </section>
  );
}
