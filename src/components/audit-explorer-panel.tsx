import Link from "next/link";
import type { AuditExplorer } from "@/application/operations-v2";

export function AuditExplorerPanel({
  workspace,
  filters,
}: {
  workspace: AuditExplorer;
  filters: { actionPrefix?: string; targetType?: string };
}) {
  const nextQuery = new URLSearchParams();
  if (filters.actionPrefix) {
    nextQuery.set("auditAction", filters.actionPrefix);
  }
  if (filters.targetType) {
    nextQuery.set("auditTarget", filters.targetType);
  }
  if (workspace.nextCursor) {
    nextQuery.set("auditCursor", String(workspace.nextCursor));
  }

  return (
    <section className="workspace-section" aria-labelledby="audit-explorer">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Append-only audit</p>
          <h2 id="audit-explorer">稽核事件查詢</h2>
        </div>
        <span>{workspace.items.length} 筆</span>
      </div>
      <p>
        僅顯示安全事件中繼資料與不可變雜湊；不回傳事件 payload、理由、來源
        IP、請求 ID 或原始目標識別。
      </p>
      <form className="queue-filters" method="get">
        <label>
          Action 前綴
          <input
            defaultValue={filters.actionPrefix}
            maxLength={80}
            name="auditAction"
            pattern="[a-z0-9_.-]+"
            placeholder="例如 refund."
          />
        </label>
        <label>
          目標類型
          <input
            defaultValue={filters.targetType}
            maxLength={80}
            name="auditTarget"
            pattern="[a-z0-9_.-]+"
            placeholder="例如 refund_case"
          />
        </label>
        <button className="button secondary" type="submit">
          套用稽核篩選
        </button>
      </form>
      {workspace.items.length ? (
        <div className="staff-item-list">
          {workspace.items.map((item) => (
            <article key={item.sequence}>
              <span>
                {item.actorKind === "system" ? "系統" : "已識別操作者"}
              </span>
              <strong>{item.action}</strong>
              <p>
                {item.targetType}／{item.targetReference}
              </p>
              <small>
                #{item.sequence} ·{" "}
                {new Date(item.occurredAt).toLocaleString("zh-TW")} · hash{" "}
                {item.eventHash.slice(0, 16)}…
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="closed-note">沒有符合篩選條件的安全事件。</p>
      )}
      {workspace.nextCursor && (
        <Link
          className="button secondary"
          href={`/staff/operations?${nextQuery.toString()}`}
        >
          查看更早事件
        </Link>
      )}
    </section>
  );
}
