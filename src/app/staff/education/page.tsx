import Link from "next/link";
import { redirect } from "next/navigation";
import { readEducationQualityWorkspace } from "@/application/education-quality";
import { EducationQualityWorkspace } from "@/components/education-quality-workspace";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffEducationPage() {
  const { supabase } = await requireUser().catch(() =>
    redirect("/staff/login"),
  );
  const { data: authorized } = await supabase.rpc("authorize_staff_action", {
    p_required_role: "course_admin",
    p_action: "staff.education_quality.workspace",
    p_target: "course_versions",
  });
  if (authorized !== true) redirect("/staff/security");

  const workspace = await readEducationQualityWorkspace(supabase).catch(
    () => null,
  );

  return (
    <main className="page-shell shell">
      <p className="eyebrow">教學品管部</p>
      <h1>課程上架工作台</h1>
      <p className="lead">
        建立課程、設定報名方式、預覽後送審；執行長核准前不會顯示在前台。
      </p>
      {workspace ? (
        <EducationQualityWorkspace workspace={workspace} />
      ) : (
        <div className="warning-panel">
          <strong>目前無法讀取課程工作台</strong>
          <p>
            系統維持安全關閉，不會改用寬鬆權限讀取課程。請先完成後台雙重驗證，再重新整理頁面。
          </p>
          <div className="page-actions">
            <Link className="button" href="/staff/security">
              前往安全驗證
            </Link>
          </div>
        </div>
      )}
      <div className="page-actions">
        <Link className="button secondary" href="/staff">
          返回工作人員首頁
        </Link>
      </div>
    </main>
  );
}
