import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readLearnerWorkspaceWithSafeFallback } from "@/application/workspace";
import { LearnerCourseRunner } from "@/components/learner-course-runner";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function LearningPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ activity?: string; lesson?: string }>;
}) {
  const { enrollmentId } = await params;
  const requestedActivity = await searchParams;
  const { supabase } = await requireUser().catch(() => redirect("/login"));

  let result: Awaited<ReturnType<typeof readLearnerWorkspaceWithSafeFallback>>;
  try {
    result = await readLearnerWorkspaceWithSafeFallback(supabase, enrollmentId);
  } catch {
    return (
      <section className="classroom-error-page">
        <div>
          <p className="eyebrow">歲悅學苑數位教室</p>
          <h1>目前無法讀取課程內容</h1>
          <p>
            系統無法確認完整課程與你的修課權限，因此不會提供影片或直播連結。已保存的有效分鐘不會由瀏覽器覆寫。
          </p>
          <div className="page-actions">
            <Link className="button" href="/learner">
              返回我的課程
            </Link>
            <Link className="button secondary" href="/support">
              聯絡客服
            </Link>
          </div>
        </div>
      </section>
    );
  }
  if (!result) notFound();
  const initialActivityId =
    requestedActivity.activity ?? requestedActivity.lesson ?? undefined;

  return (
    <LearnerCourseRunner
      enrollmentId={enrollmentId}
      initialActivityId={initialActivityId}
      key={initialActivityId ?? "default"}
      projectionReady={result.projectionReady}
      workspace={result.workspace}
    />
  );
}
