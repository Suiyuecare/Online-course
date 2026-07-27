import Link from "next/link";
import { redirect } from "next/navigation";
import { readQuizAttemptInvalidationWorkspace } from "@/application/quiz-attempt-invalidation";
import { QuizAttemptInvalidationPanel } from "@/components/quiz-attempt-invalidation-panel";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function QuizAttemptInvalidationPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const { data: authorized } = await supabase.rpc("authorize_staff_action", {
    p_required_role: "accreditation_reviewer",
    p_action: "staff.quiz_attempt_invalidation",
    p_target: "quiz-attempts",
  });
  if (authorized !== true) redirect("/staff/security");

  let workspace: Awaited<
    ReturnType<typeof readQuizAttemptInvalidationWorkspace>
  > | null = null;
  try {
    workspace = await readQuizAttemptInvalidationWorkspace(supabase);
  } catch {
    // The workflow fails closed when the narrow, answer-free projection is
    // unavailable. It never falls back to quiz item or response table reads.
  }

  return (
    <section className="page-shell shell">
      <p className="eyebrow">積分審核</p>
      <h1>測驗作答作廢覆核</h1>
      <p className="lead">
        從安全清單選擇整次測驗紀錄，留下理由，再由另一位積分審核員做出決定。
      </p>
      <p>
        <Link href="/staff/accreditation">返回積分審核與送審</Link>
      </p>
      {workspace ? (
        <QuizAttemptInvalidationPanel workspace={workspace} />
      ) : (
        <div className="warning-panel">
          <strong>測驗作廢工作區尚未準備完成</strong>
          <p>
            安全清單無法讀取時，系統不會要求手動貼上測驗或案件識別碼，也不會讀取學員的原始作答內容。
          </p>
        </div>
      )}
    </section>
  );
}
