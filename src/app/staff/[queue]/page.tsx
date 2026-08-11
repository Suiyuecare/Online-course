import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import {
  readCourseSubmissionReview,
  readOrganizationApplicationReview,
  type CourseSubmissionReview,
  type OrganizationApplicationReview,
} from "@/application/admin-review-workflows";
import {
  readAccreditationOperationsWorkspace,
  readStaffQueueItems,
  readZoomOrphanCleanupWorklist,
  readZoomSetupReconciliationWorklist,
} from "@/application/workspace";
import {
  readOrganizationLifecycleControls,
  type OrganizationLifecycleItem,
} from "@/application/organization-lifecycle";
import {
  readOperationsControlPlane,
  type OperationsControlPlane,
} from "@/application/operations-control-plane";
import {
  readAuditExplorer,
  readRetentionControlPlane,
  readSlaWorkspace,
  type AuditExplorer,
  type RetentionControlPlane,
  type SlaWorkspace,
} from "@/application/operations-v2";
import {
  readStaffRoleCandidates,
  type StaffRoleCandidate,
} from "@/application/staff-role-directory";
import { AccreditationOperationsPanel } from "@/components/accreditation-operations-panel";
import { AuditExplorerPanel } from "@/components/audit-explorer-panel";
import { CourseSubmissionReviewPanel } from "@/components/course-submission-review-panel";
import { EmergencySuspendPanel } from "@/components/emergency-suspend-panel";
import { FinanceBankImportPanel } from "@/components/finance-bank-import-panel";
import { OrganizationLifecyclePanel } from "@/components/organization-lifecycle-panel";
import { OperationsControlPanel } from "@/components/operations-control-panel";
import { OrganizationApplicationReviewSummary } from "@/components/organization-application-review-summary";
import { RetentionControlPanel } from "@/components/retention-control-panel";
import { SlaWorkspacePanel } from "@/components/sla-workspace-panel";
import { StaffRoleCandidatePanel } from "@/components/staff-role-candidate-panel";
import { StaffQueueActions } from "@/components/staff-queue-actions";
import {
  ZoomOrphanCleanupPanel,
  ZoomSetupReconciliationPanel,
} from "@/components/zoom-setup-reconciliation-panel";
import { requireUser } from "@/infrastructure/supabase/server";

const queueContent: Record<
  string,
  { title: string; description: string; tasks: string[] }
> = {
  courses: {
    title: "課程與影片",
    description: "建立三種課型、不可變版本、題庫與雙人發布檢查。",
    tasks: [
      "草稿待補資料",
      "Stream 處理失敗",
      "待 accreditation reviewer 審核",
    ],
  },
  accreditation: {
    title: "積分審核與送審",
    description: "身分補正、核定 revision、資格預覽與一次性完整匯出。",
    tasks: ["積分身分待核", "送審資料缺件", "認可單位結果待回填"],
  },
  finance: {
    title: "匯款、發票與退款",
    description: "以銀行交易與 allocation ledger 核對，不以 proof 開權限。",
    tasks: ["匯款待核", "銀行批次待覆核", "人工發票待辦", "退款待匯回"],
  },
  live: {
    title: "直播與出席",
    description: "主備主持人、容量、助理、24 小時 evidence settlement。",
    tasks: ["場次容量衝突", "Zoom webhook 延遲", "出席異常待雙人補正"],
  },
  organizations: {
    title: "機構與點數",
    description: "機構審核、購點雙人核准、指派與永不過期 point lots。",
    tasks: ["機構申請待核", "購點待第二人確認", "錢包 drift 檢查"],
  },
  operations: {
    title: "供應商與事故",
    description: "所有開關預設關閉；provider、法務或財務缺件即 fail closed。",
    tasks: [
      "Provider health",
      "通知 dead-letter",
      "Cron freshness",
      "備份 manifest",
    ],
  },
};

export default async function StaffQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ queue: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    cursor?: string;
    selected?: string;
    auditAction?: string;
    auditTarget?: string;
    auditCursor?: string;
    slaDeadline?: string;
    slaReference?: string;
  }>;
}) {
  const { queue } = await params;
  const filters = await searchParams;
  const content = queueContent[queue];
  if (!content) notFound();
  const requiredRoles: Record<string, string[]> = {
    courses: ["course_admin", "accreditation_reviewer"],
    accreditation: ["accreditation_reviewer"],
    finance: ["finance"],
    live: ["course_admin", "accreditation_reviewer"],
    organizations: ["platform_admin"],
    operations: ["platform_admin"],
  };
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const authorizations = await Promise.all(
    requiredRoles[queue].map((role) =>
      supabase.rpc("authorize_staff_action", {
        p_required_role: role,
        p_action: `staff.queue.${queue}`,
        p_target: queue,
      }),
    ),
  );
  if (!authorizations.some(({ data }) => data === true)) {
    redirect("/staff/security");
  }
  const { data: queueData, error: queueError } = await supabase.rpc(
    "read_staff_queue_counts",
    { p_queue: queue },
  );
  const queueCounts = z
    .array(
      z.object({
        label: z.string(),
        count: z.number().int().nonnegative(),
      }),
    )
    .safeParse(queueData);
  if (queueError || !queueCounts.success) redirect("/staff/security");
  let worklist: Awaited<ReturnType<typeof readStaffQueueItems>> | null = null;
  let zoomSetupReconciliations: Awaited<
    ReturnType<typeof readZoomSetupReconciliationWorklist>
  > = [];
  let zoomOrphanCleanups: Awaited<
    ReturnType<typeof readZoomOrphanCleanupWorklist>
  > = [];
  let accreditationOperations: Awaited<
    ReturnType<typeof readAccreditationOperationsWorkspace>
  > | null = null;
  let organizationLifecycle: OrganizationLifecycleItem[] | null = null;
  let staffRoleCandidates: StaffRoleCandidate[] | null = null;
  let operationsControlPlane: OperationsControlPlane | null = null;
  let auditExplorer: AuditExplorer | null = null;
  let slaWorkspace: SlaWorkspace | null = null;
  let retentionControlPlane: RetentionControlPlane | null = null;
  const slaCursor = z
    .object({
      deadlineAt: z.string().datetime({ offset: true }),
      reference: z.string().regex(/^(SUP|REF)-[A-F0-9]{12}$/),
    })
    .safeParse({
      deadlineAt: filters.slaDeadline,
      reference: filters.slaReference,
    });
  try {
    worklist = await readStaffQueueItems(supabase, {
      queue,
      search: filters.q,
      status: filters.status,
      cursor: filters.cursor,
      limit: 25,
    });
  } catch {
    // Counts remain visible; no broad table read or service-role fallback.
  }
  if (queue === "live") {
    try {
      zoomSetupReconciliations =
        await readZoomSetupReconciliationWorklist(supabase);
    } catch {
      // The primary worklist remains usable while this narrow projection is
      // unavailable. No table-level or service-role fallback is attempted.
    }
  }
  if (queue === "live" || queue === "operations") {
    try {
      zoomOrphanCleanups = await readZoomOrphanCleanupWorklist(supabase);
    } catch {
      // Automatic cleanup remains authoritative; this projection never falls
      // back to a broad durable-jobs table read.
    }
  }
  if (queue === "courses" || queue === "accreditation") {
    try {
      accreditationOperations =
        await readAccreditationOperationsWorkspace(supabase);
    } catch {
      // The ordinary queue stays available. Accreditation lifecycle and
      // submission controls fail closed without a safe projection.
    }
  }
  if (queue === "organizations") {
    try {
      organizationLifecycle = await readOrganizationLifecycleControls(
        supabase,
        {
          search: filters.q,
          limit: 100,
        },
      );
    } catch {
      // The ordinary application queue remains available. Lifecycle controls
      // never fall back to a broad organizations table read.
    }
  }
  if (queue === "operations") {
    try {
      operationsControlPlane = await readOperationsControlPlane(supabase);
    } catch {
      // Operational mutations remain fail-closed without the narrow,
      // role-scoped projection. No direct queue, incident, or evidence table
      // fallback is attempted.
    }
    try {
      staffRoleCandidates = await readStaffRoleCandidates(supabase, {
        search: filters.q,
        limit: 25,
      });
    } catch {
      // Role onboarding remains unavailable rather than falling back to
      // auth.users or a broad people table read.
    }
    try {
      const cursor = z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .safeParse(filters.auditCursor);
      auditExplorer = await readAuditExplorer(supabase, {
        actionPrefix: filters.auditAction,
        targetType: filters.auditTarget,
        cursor: cursor.success ? cursor.data : undefined,
        limit: 25,
      });
    } catch {
      // Audit payloads, reasons, request identifiers and source addresses are
      // never fetched as a fallback when the safe projection is unavailable.
    }
    try {
      slaWorkspace = await readSlaWorkspace(supabase, "all", {
        cursor: slaCursor.success ? slaCursor.data : undefined,
        limit: 50,
      });
    } catch {
      // The operations queue remains available without exposing support or
      // refund case bodies through a broader table read.
    }
    try {
      retentionControlPlane = await readRetentionControlPlane(supabase);
    } catch {
      // Retention controls fail closed. There is deliberately no direct-table,
      // dynamic-SQL, or physical-delete fallback.
    }
  }
  if (queue === "finance") {
    try {
      slaWorkspace = await readSlaWorkspace(supabase, "refund", {
        cursor: slaCursor.success ? slaCursor.data : undefined,
        limit: 50,
      });
    } catch {
      // Refund details stay in their dedicated workflow; this panel only uses
      // the safe SLA projection and disappears if it is unavailable.
    }
  }
  const selected =
    worklist?.items.find((item) => item.itemId === filters.selected) ?? null;
  let organizationApplicationReview: OrganizationApplicationReview | null =
    null;
  let courseSubmissionReview: CourseSubmissionReview | null = null;
  if (
    selected?.kind === "organization_application" &&
    selected.status === "submitted"
  ) {
    try {
      organizationApplicationReview = await readOrganizationApplicationReview(
        supabase,
        selected.itemId.replace(/^organization:/, ""),
      );
    } catch {
      // Decisions stay hidden when the dedicated, masked review projection is
      // unavailable. The general queue item is never treated as sufficient.
    }
  }
  if (selected?.kind === "course_version" && selected.status === "in_review") {
    try {
      courseSubmissionReview = await readCourseSubmissionReview(
        supabase,
        selected.itemId.replace(/^course:/, ""),
      );
    } catch {
      // Publish, return, and reject all fail closed without the narrow
      // submission-review projection.
    }
  }
  const filterQuery = new URLSearchParams();
  if (filters.q) filterQuery.set("q", filters.q);
  if (filters.status) filterQuery.set("status", filters.status);
  return (
    <section className="page-shell shell">
      <p className="eyebrow">工作佇列</p>
      <h1>{content.title}</h1>
      <p className="lead">{content.description}</p>
      {queue === "live" && (
        <ZoomSetupReconciliationPanel items={zoomSetupReconciliations} />
      )}
      {(queue === "live" || queue === "operations") && (
        <ZoomOrphanCleanupPanel items={zoomOrphanCleanups} />
      )}
      {(queue === "courses" || queue === "accreditation") &&
        (accreditationOperations ? (
          <AccreditationOperationsPanel workspace={accreditationOperations} />
        ) : (
          <div className="warning-panel">
            <strong>積分作業控制台尚未準備完成</strong>
            <p>
              核定生命週期與送審批次在安全投影恢復前保持不可操作，不會要求手動輸入資料庫識別碼。
            </p>
          </div>
        ))}
      {queue === "organizations" &&
        (organizationLifecycle ? (
          <OrganizationLifecyclePanel items={organizationLifecycle} />
        ) : (
          <div className="warning-panel">
            <strong>機構停權與復權控制暫時無法使用</strong>
            <p>
              安全投影恢復前，網站不會要求管理員手動修改資料庫；申請審核清單仍可獨立使用。
            </p>
          </div>
        ))}
      {queue === "operations" &&
        (operationsControlPlane ? (
          <OperationsControlPanel workspace={operationsControlPlane} />
        ) : (
          <div className="warning-panel">
            <strong>營運控制台暫時無法使用</strong>
            <p>
              安全投影恢復前，事故狀態、dead-letter
              與備援證據維持不可操作；系統不會改用直接資料表存取。
            </p>
          </div>
        ))}
      {queue === "operations" &&
        (auditExplorer ? (
          <AuditExplorerPanel
            filters={{
              actionPrefix: filters.auditAction,
              targetType: filters.auditTarget,
            }}
            workspace={auditExplorer}
          />
        ) : (
          <div className="warning-panel">
            <strong>安全稽核查詢暫時無法使用</strong>
            <p>
              系統不會退回原始事件 payload、理由、來源 IP 或未遮罩目標識別。
            </p>
          </div>
        ))}
      {queue === "operations" &&
        (slaWorkspace ? (
          <SlaWorkspacePanel
            nextHref={
              slaWorkspace.nextCursor
                ? `/staff/operations?${new URLSearchParams({
                    slaDeadline: slaWorkspace.nextCursor.deadlineAt,
                    slaReference: slaWorkspace.nextCursor.reference,
                  }).toString()}`
                : undefined
            }
            workspace={slaWorkspace}
          />
        ) : (
          <div className="warning-panel">
            <strong>SLA 安全投影暫時無法使用</strong>
            <p>
              自動升級排程仍由 durable worker
              執行；此畫面不會改讀客服內容或退款帳務資料。
            </p>
          </div>
        ))}
      {queue === "operations" &&
        (retentionControlPlane ? (
          <RetentionControlPanel workspace={retentionControlPlane} />
        ) : (
          <div className="warning-panel">
            <strong>保存政策 dry-run 暫時無法使用</strong>
            <p>
              候選摘要與雙人證據控制恢復前，不允許以人工 SQL
              或任何實體清除取代。
            </p>
          </div>
        ))}
      {queue === "finance" &&
        (slaWorkspace ? (
          <SlaWorkspacePanel
            nextHref={
              slaWorkspace.nextCursor
                ? `/staff/finance?${new URLSearchParams({
                    slaDeadline: slaWorkspace.nextCursor.deadlineAt,
                    slaReference: slaWorkspace.nextCursor.reference,
                  }).toString()}`
                : undefined
            }
            title="退款案件 SLA"
            workspace={slaWorkspace}
          />
        ) : (
          <div className="warning-panel">
            <strong>退款 SLA 投影暫時無法使用</strong>
            <p>退款內容與帳務資料不會透過一般工作佇列降級顯示。</p>
          </div>
        ))}
      {queue === "operations" &&
        (staffRoleCandidates ? (
          <StaffRoleCandidatePanel candidates={staffRoleCandidates} />
        ) : (
          <div className="warning-panel">
            <strong>後台角色候選人目錄暫時無法使用</strong>
            <p>
              系統不會要求輸入人員 UUID，也不會直接讀取 Auth
              名單；既有雙人覆核案件仍可獨立處理。
            </p>
          </div>
        ))}
      <div className="work-queue">
        {queueCounts.data.map((task) => (
          <article key={task.label}>
            <span>{task.count}</span>
            <h2>{task.label}</h2>
            <p>資料庫會依 active role、identity epoch 與狀態重新授權。</p>
          </article>
        ))}
      </div>
      {!worklist && (
        <div className="warning-panel">
          <strong>案件清單暫時無法顯示</strong>
          <p>
            統計數字不包含可操作權限。安全案件投影恢復前，網站不會要求你手動貼上資料庫編號，也不會改用跨角色查詢。
          </p>
        </div>
      )}
      {worklist && (
        <div className="staff-workspace">
          <section>
            <form className="queue-filters" method="get">
              <label>
                搜尋
                <input
                  defaultValue={filters.q}
                  name="q"
                  placeholder="訂單編號、課程、機構或遮罩姓名"
                />
              </label>
              <label>
                狀態
                <select name="status" defaultValue={filters.status ?? ""}>
                  <option value="">全部待辦狀態</option>
                  {worklist.availableStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button secondary" type="submit">
                套用篩選
              </button>
            </form>
            <div className="staff-item-list">
              {worklist.items.map((item) => {
                const itemQuery = new URLSearchParams(filterQuery);
                itemQuery.set("selected", item.itemId);
                return (
                  <Link
                    aria-current={selected?.itemId === item.itemId}
                    href={`/staff/${queue}?${itemQuery.toString()}`}
                    key={item.itemId}
                  >
                    <span>{item.statusLabel}</span>
                    <strong>{item.title}</strong>
                    <p>{item.referenceLabel}</p>
                    <small>
                      更新於 {new Date(item.updatedAt).toLocaleString("zh-TW")}
                    </small>
                  </Link>
                );
              })}
              {worklist.items.length === 0 && (
                <p className="closed-note">沒有符合此搜尋與狀態的案件。</p>
              )}
            </div>
            {worklist.nextCursor && (
              <Link
                className="button secondary"
                href={`/staff/${queue}?${new URLSearchParams({
                  ...(filters.q ? { q: filters.q } : {}),
                  ...(filters.status ? { status: filters.status } : {}),
                  cursor: worklist.nextCursor,
                }).toString()}`}
              >
                查看下一頁
              </Link>
            )}
          </section>
          <section className="staff-item-detail">
            {selected ? (
              <>
                <p className="eyebrow">{selected.statusLabel}</p>
                <h2>{selected.title}</h2>
                <p>{selected.summary}</p>
                <dl className="compact-data-list">
                  {selected.context.map((entry) => (
                    <div key={entry.label}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
                {selected.kind === "organization_application" &&
                  selected.status === "submitted" &&
                  (organizationApplicationReview ? (
                    <OrganizationApplicationReviewSummary
                      review={organizationApplicationReview}
                    />
                  ) : (
                    <div className="warning-panel">
                      <strong>申請審核資料暫時無法讀取</strong>
                      <p>
                        完整的安全投影恢復前，核准與拒絕按鈕保持關閉，避免只依案件標題作成決定。
                      </p>
                    </div>
                  ))}
                {selected.kind === "course_version" &&
                  selected.status === "in_review" &&
                  (courseSubmissionReview ? (
                    <CourseSubmissionReviewPanel
                      review={courseSubmissionReview}
                    />
                  ) : (
                    <div className="warning-panel">
                      <strong>課程送審資料暫時無法讀取</strong>
                      <p>
                        發布、退回與駁回保持關閉；系統不會以不完整資料作成審核結果。
                      </p>
                    </div>
                  ))}
                {(!(
                  selected.kind === "organization_application" &&
                  selected.status === "submitted"
                ) ||
                  organizationApplicationReview?.canReview) &&
                  (!(
                    selected.kind === "course_version" &&
                    selected.status === "in_review"
                  ) ||
                    courseSubmissionReview?.canDecide) && (
                    <StaffQueueActions item={selected} />
                  )}
              </>
            ) : (
              <div className="empty-state">
                <h2>選擇一筆案件</h2>
                <p>
                  左側只顯示你目前角色可處理的案件；選取後才會顯示去敏感內容與可執行操作。
                </p>
              </div>
            )}
          </section>
        </div>
      )}
      {queueCounts.data.every((item) => item.count === 0) && (
        <p className="closed-note">
          目前沒有待辦；這裡不建立示範案件，正式資料只由受控流程與 provider
          event 產生。
        </p>
      )}
      {queue === "courses" && (
        <div className="page-actions">
          <Link className="button" href="/staff/courses/editor">
            建立或繼續編輯課程
          </Link>
          <Link className="button secondary" href="/staff/setup">
            管理平台先決資料
          </Link>
        </div>
      )}
      {queue === "operations" && <EmergencySuspendPanel />}
      {queue === "finance" && <FinanceBankImportPanel />}
    </section>
  );
}
