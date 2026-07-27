import { redirect } from "next/navigation";
import {
  readOrganizationWorkspaceDetails,
  readOwnOrganizationApplication,
  type OrganizationWorkspaceDetails,
} from "@/application/workspace";
import {
  OrganizationActions,
  OrganizationApplicationForm,
} from "@/components/organization-actions";
import { OrganizationManagementPanel } from "@/components/organization-management-panel";
import { OrganizationRecords } from "@/components/organization-records";
import { EmailVerification } from "@/components/email-verification";
import { presentStatus } from "@/domain/presentation";
import { catalogCourses } from "@/infrastructure/supabase/catalog";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function OrganizationWorkspace() {
  let workspace: {
    organization_id: string;
    organization_name: string;
    role: string;
    available_points: number;
    reserved_points: number;
    refund_reserved_points: number;
    consumed_points: number;
    refunded_points: number;
    member_count: number;
  } | null = null;
  let details: OrganizationWorkspaceDetails | null = null;
  let application: Awaited<ReturnType<typeof readOwnOrganizationApplication>> =
    null;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  try {
    const { data } = await supabase
      .from("organization_workspace")
      .select("*")
      .maybeSingle();
    workspace = data;
    if (workspace) {
      try {
        details = await readOrganizationWorkspaceDetails(
          supabase,
          workspace.organization_id,
        );
      } catch {
        // Actions that require a detailed projection remain unavailable below.
      }
    } else {
      try {
        application = await readOwnOrganizationApplication(supabase);
      } catch {
        // A missing projection never grants access; the application form remains.
      }
    }
  } catch {
    // The page stays fail closed and reveals no organization data.
  }
  if (!workspace) {
    const status = application
      ? presentStatus("organization", application.status)
      : null;
    return (
      <section className="page-shell narrow shell">
        {application && status ? (
          <>
            <p className="eyebrow">機構申請</p>
            <h1>{application.organizationName}</h1>
            <div className={`status-card status-${status.tone}`}>
              <strong>{status.label}</strong>
              <p>{status.description}</p>
              {application.reasonSummary && (
                <p>審核說明：{application.reasonSummary}</p>
              )}
              {status.nextAction && <p>下一步：{status.nextAction}</p>}
            </div>
            {application.status === "rejected" && (
              <p className="closed-note">
                為避免同一統編建立重複機構，請依通知由客服協助補正，勿重新建立另一筆申請。
              </p>
            )}
          </>
        ) : (
          <>
            <div className="empty-state">
              <h1>尚未加入已核准機構</h1>
              <p>請接受手機邀請，或提交機構名稱、統編與聯絡資料供審核。</p>
            </div>
            <EmailVerification />
            <OrganizationApplicationForm />
          </>
        )}
      </section>
    );
  }
  return (
    <section className="dashboard-page shell">
      <p className="eyebrow">機構工作台</p>
      <h1>{workspace.organization_name}</h1>
      <div className="metric-grid">
        <article>
          <span>可用點數</span>
          <strong>{workspace.available_points.toLocaleString("zh-TW")}</strong>
        </article>
        <article>
          <span>已保留</span>
          <strong>{workspace.reserved_points.toLocaleString("zh-TW")}</strong>
        </article>
        <article>
          <span>已使用</span>
          <strong>{workspace.consumed_points.toLocaleString("zh-TW")}</strong>
        </article>
        <article>
          <span>退款凍結</span>
          <strong>
            {workspace.refund_reserved_points.toLocaleString("zh-TW")}
          </strong>
        </article>
        <article>
          <span>已退款</span>
          <strong>{workspace.refunded_points.toLocaleString("zh-TW")}</strong>
        </article>
        <article>
          <span>員工</span>
          <strong>{workspace.member_count}</strong>
        </article>
      </div>
      {!details && (
        <div className="warning-panel">
          <strong>詳細工作資料暫時無法顯示</strong>
          <p>
            系統不會改用跨機構權限查詢。涉及購點紀錄、直播選場、收回與成果的選單會保持空白，直到機構專用安全投影恢復。
          </p>
        </div>
      )}
      {details && (
        <OrganizationManagementPanel
          details={details}
          organizationId={workspace.organization_id}
        />
      )}
      {details && <OrganizationRecords details={details} />}
      <OrganizationActions
        organizationId={workspace.organization_id}
        role={workspace.role}
        members={(details?.members ?? [])
          .filter((member) => member.status === "active")
          .map((member) => ({
            personId: member.personId,
            employeeNumber: member.employeeNumber,
            department: member.department,
          }))}
        courses={(await catalogCourses())
          .filter((course) => course.organization_point_price)
          .map((course) => ({
            id: course.course_version_id,
            title: course.title,
            points: course.organization_point_price ?? 0,
          }))}
        details={details}
      />
    </section>
  );
}
