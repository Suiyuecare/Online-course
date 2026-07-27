import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import {
  readAccreditationOperationsWorkspace,
  readStaffQueueItems,
  readZoomOrphanCleanupWorklist,
  readZoomSetupReconciliationWorklist,
} from "@/application/workspace";
import { AccreditationOperationsPanel } from "@/components/accreditation-operations-panel";
import { EmergencySuspendPanel } from "@/components/emergency-suspend-panel";
import { FinanceBankImportPanel } from "@/components/finance-bank-import-panel";
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
  const selected =
    worklist?.items.find((item) => item.itemId === filters.selected) ?? null;
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
                <StaffQueueActions item={selected} />
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
