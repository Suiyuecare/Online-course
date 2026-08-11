import Link from "next/link";
import type { SlaWorkspace } from "@/application/operations-v2";

const slaLabels = {
  overdue: "已逾期",
  due_soon: "即將到期",
  on_track: "時限內",
} as const;

export function SlaWorkspacePanel({
  workspace,
  title = "客服與退款 SLA",
  nextHref,
}: {
  workspace: SlaWorkspace;
  title?: string;
  nextHref?: string;
}) {
  return (
    <section className="workspace-section" aria-labelledby="sla-workspace">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Safe SLA projection</p>
          <h2 id="sla-workspace">{title}</h2>
        </div>
        <span>{workspace.items.length} 筆進行中</span>
      </div>
      <p>
        排程只建立本地 durable job 與 append-only
        升級事件，不會在此自動寄信、傳簡訊或揭露案件內容。
      </p>
      {workspace.items.length ? (
        <div className="record-grid">
          {workspace.items.map((item) => (
            <article
              className="context-action-form"
              key={`${item.sourceKind}:${item.reference}`}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{item.sourceKind}</p>
                  <h3>{item.reference}</h3>
                </div>
                <span className={`status ${item.slaState}`}>
                  {slaLabels[item.slaState]}
                </span>
              </div>
              <dl className="compact-data-list">
                <div>
                  <dt>安全分類</dt>
                  <dd>{item.category}</dd>
                </div>
                <div>
                  <dt>狀態／優先度</dt>
                  <dd>
                    {item.status}／{item.priority}
                  </dd>
                </div>
                <div>
                  <dt>期限</dt>
                  <dd>{new Date(item.deadlineAt).toLocaleString("zh-TW")}</dd>
                </div>
                <div>
                  <dt>最近自動升級事件</dt>
                  <dd>
                    {item.latestEscalationAt
                      ? new Date(item.latestEscalationAt).toLocaleString(
                          "zh-TW",
                        )
                      : "尚無"}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <p className="closed-note">目前沒有進行中的 SLA 案件。</p>
      )}
      {workspace.nextCursor && nextHref && (
        <Link className="button secondary" href={nextHref}>
          查看下一頁 SLA
        </Link>
      )}
    </section>
  );
}
