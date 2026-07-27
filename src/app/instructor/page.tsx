import { redirect } from "next/navigation";
import { readInstructorDashboard } from "@/application/workspace";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const ratingLabels = ["內容", "講師", "節奏", "實用性", "整體"];

export default async function InstructorPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const dashboard = await readInstructorDashboard(supabase).catch(() => null);
  if (!dashboard) redirect("/staff/security");

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
