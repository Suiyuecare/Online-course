import Link from "next/link";
import { redirect } from "next/navigation";
import {
  readCertificateRevocationWorkspace,
  readSurveyInvestigationWorkspace,
} from "@/application/quality-workspace";
import { CertificateRevocationPanel } from "@/components/certificate-revocation-panel";
import { SurveyInvestigationPanel } from "@/components/survey-investigation-panel";
import type {
  CertificateRevocationWorkspace,
  SurveyInvestigationWorkspace,
} from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const filters = await searchParams;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const [certificateAuthorization, surveyAuthorization] = await Promise.all([
    supabase.rpc("authorize_staff_action", {
      p_required_role: "accreditation_reviewer",
      p_action: "staff.quality.certificate_revocations.read",
      p_target: "certificate_revocations",
    }),
    supabase.rpc("authorize_staff_action", {
      p_required_role: "platform_admin",
      p_action: "staff.quality.survey_investigations.read",
      p_target: "survey_investigations",
    }),
  ]);
  const canReviewCertificates = certificateAuthorization.data === true;
  const canInvestigateSurveys = surveyAuthorization.data === true;
  if (!canReviewCertificates && !canInvestigateSurveys) {
    redirect("/staff/security");
  }

  let certificateWorkspace: CertificateRevocationWorkspace | null = null;
  let surveyWorkspace: SurveyInvestigationWorkspace | null = null;
  if (canReviewCertificates) {
    try {
      certificateWorkspace = await readCertificateRevocationWorkspace(
        supabase,
        { search: filters.q },
      );
    } catch {
      // The mutation RPCs remain inaccessible without a safe selectable list.
    }
  }
  if (canInvestigateSurveys) {
    try {
      surveyWorkspace = await readSurveyInvestigationWorkspace(supabase, {
        search: filters.q,
        cursor: filters.cursor,
      });
    } catch {
      // Never fall back to survey tables or expose raw comments in a list.
    }
  }

  return (
    <main className="page-shell shell">
      <p className="eyebrow">品質與積分稽核</p>
      <h1>證明撤銷與問卷調查</h1>
      <p className="lead">
        撤證採申請人與決定人分離；問卷清單永遠不含文字原文，只有具必要性且重新驗證的單筆調查才可讀取。
      </p>
      <form className="queue-filters" method="get">
        <label>
          搜尋課程或遮罩姓名
          <input
            defaultValue={filters.q}
            name="q"
            maxLength={200}
            placeholder="例如：失智照護"
          />
        </label>
        <button className="button secondary" type="submit">
          套用搜尋
        </button>
      </form>

      {canReviewCertificates &&
        (certificateWorkspace ? (
          <CertificateRevocationPanel workspace={certificateWorkspace} />
        ) : (
          <div className="warning-panel">
            <strong>撤證安全清單尚未準備完成</strong>
            <p>
              在可選擇的去敏感投影恢復前，網站不會要求你手動貼上證明或撤證案件編號。
            </p>
          </div>
        ))}

      {canInvestigateSurveys &&
        (surveyWorkspace ? (
          <>
            <SurveyInvestigationPanel workspace={surveyWorkspace} />
            {surveyWorkspace.nextCursor && (
              <Link
                className="button secondary"
                href={`/staff/quality?${new URLSearchParams({
                  ...(filters.q ? { q: filters.q } : {}),
                  cursor: surveyWorkspace.nextCursor,
                }).toString()}`}
              >
                查看下一頁問卷
              </Link>
            )}
          </>
        ) : (
          <div className="warning-panel">
            <strong>問卷去識別清單尚未準備完成</strong>
            <p>
              系統不會改讀問卷資料表，也不會在清單或錯誤訊息中暴露文字原文。
            </p>
          </div>
        ))}

      <div className="page-actions">
        <Link className="button secondary" href="/staff">
          返回工作人員首頁
        </Link>
      </div>
    </main>
  );
}
