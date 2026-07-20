"use client";

import { type ReactNode, useMemo, useState } from "react";
import { BookOpenCheck, History, LoaderCircle, PackageCheck } from "lucide-react";

export type EnterpriseAdminOrderRow = {
  id: string;
  organization_id: string;
  merchant_trade_no?: string;
  status: string;
  amount_twd?: number;
  created_at: string;
  masked?: boolean;
};

export type EnterpriseAdminSeatLotRow = {
  id: string;
  organization_id: string;
  course_id: string;
  total_quantity?: number;
  available_quantity?: number;
  status: string;
  valid_until: string;
  created_at: string;
  masked?: boolean;
};

export type EnterpriseAdminSeatEventRow = {
  id: number;
  organization_id: string;
  seat_lot_id: string;
  allocation_id?: string | null;
  event_type: string;
  quantity?: number;
  available_delta?: number;
  occurred_at: string;
  masked?: boolean;
};

export type EnterpriseAdminAllocationRow = {
  id: string;
  organization_id: string;
  course_id: string;
  learner_id: string;
  live_session_id?: string | null;
  status: string;
  assigned_at: string;
};

export type EnterpriseAdminLiveSessionRow = {
  id: string;
  course_id: string;
  title: string;
  starts_at: string;
  status: string;
};

export type EnterpriseAdminAuditRow = {
  id: number;
  organization_id?: string | null;
  action: string;
  target_type: string;
  target_id?: string;
  occurred_at: string;
  masked?: boolean;
};

export function EnterpriseAdminOperations({
  orders,
  seatLots,
  seatEvents,
  allocations,
  liveSessions,
  audits,
  organizationNames,
  courseNames,
  readOnly,
}: {
  orders: EnterpriseAdminOrderRow[];
  seatLots: EnterpriseAdminSeatLotRow[];
  seatEvents: EnterpriseAdminSeatEventRow[];
  allocations: EnterpriseAdminAllocationRow[];
  liveSessions: EnterpriseAdminLiveSessionRow[];
  audits: EnterpriseAdminAuditRow[];
  organizationNames: Record<string, string>;
  courseNames: Record<string, string>;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionByAllocation, setSessionByAllocation] = useState<
    Record<string, string>
  >({});
  const activeAllocations = useMemo(
    () => allocations.filter((allocation) => allocation.status === "assigned"),
    [allocations],
  );

  async function mutate(url: string, options: RequestInit, success: string) {
    setBusy(true);
    setMessage("");
    const response = await fetch(url, options);
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    setBusy(false);
    if (!response.ok) {
      setMessage(result?.error ?? "操作失敗，請重新確認狀態。");
      return;
    }
    setMessage(success);
    window.location.reload();
  }

  async function correctLot(lotId: string) {
    const rawDelta = window.prompt("可用名額調整量（增加填正數、扣除填負數）：");
    if (!rawDelta) return;
    const availableDelta = Number(rawDelta);
    if (!Number.isInteger(availableDelta) || availableDelta === 0) return;
    const reason = window.prompt("請填寫更正原因（至少 5 個字）：")?.trim();
    if (!reason || reason.length < 5) return;
    await mutate(
      `/api/admin/enterprise/seat-lots/${lotId}/corrections`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ availableDelta, reason }),
      },
      "名額帳本更正已新增。",
    );
  }

  async function updateAllocation(
    allocationId: string,
    action: "release" | "select_session",
  ) {
    const reason = window.prompt("請填寫人工處理原因（至少 5 個字）：")?.trim();
    if (!reason || reason.length < 5) return;
    const liveSessionId = sessionByAllocation[allocationId];
    if (action === "select_session" && !liveSessionId) {
      setMessage("請先選擇新的直播場次。");
      return;
    }
    await mutate(
      `/api/admin/enterprise/allocations/${allocationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason, liveSessionId }),
      },
      action === "release" ? "名額已釋回。" : "直播場次已由管理員調整。",
    );
  }

  return (
    <div className="mt-7 space-y-7">
      <p className="min-h-6 text-sm font-bold text-[#9A4D00]" role="status">
        {busy && <LoaderCircle className="mr-2 inline size-4 animate-spin" />}
        {message}
      </p>

      <section className="panel overflow-hidden">
        <Header icon={<PackageCheck />} title="企業訂單與名額批次" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>機構／課程</th><th>訂單或批次</th><th>金額／名額</th><th>狀態</th><th>日期</th><th>操作</th></tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={`order-${order.id}`}>
                  <td>{organizationNames[order.organization_id] ?? "機構"}</td>
                  <td>{order.masked ? "訂單編號已遮罩" : order.merchant_trade_no}</td>
                  <td>{order.masked ? "已遮罩" : `NT$ ${(order.amount_twd ?? 0).toLocaleString("zh-TW")}`}</td>
                  <td>{order.status}</td>
                  <td>{formatDate(order.created_at)}</td>
                  <td>—</td>
                </tr>
              ))}
              {seatLots.map((lot) => (
                <tr key={`lot-${lot.id}`}>
                  <td>
                    {organizationNames[lot.organization_id] ?? "機構"}
                    <span className="mt-1 block text-xs">{courseNames[lot.course_id] ?? "課程"}</span>
                  </td>
                  <td><span className="font-mono text-xs">{lot.id.slice(0, 8)}</span></td>
                  <td>{lot.masked ? "已遮罩" : `${lot.available_quantity ?? 0} / ${lot.total_quantity ?? 0} 可用`}</td>
                  <td>{lot.status}</td>
                  <td>效期 {formatDate(lot.valid_until)}</td>
                  <td>
                    {!readOnly && (
                      <button className="button-secondary" disabled={busy} onClick={() => void correctLot(lot.id)}>
                        新增更正
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!orders.length && !seatLots.length && (
                <tr><td colSpan={6} className="text-center">尚無企業付款或名額批次。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <Header icon={<BookOpenCheck />} title="直播與名額例外處理" />
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>機構／課程</th><th>學員</th><th>目前場次</th><th>指定新場次</th><th>操作</th></tr></thead>
            <tbody>
              {activeAllocations.map((allocation) => {
                const candidates = liveSessions.filter(
                  (session) => session.course_id === allocation.course_id,
                );
                return (
                  <tr key={allocation.id}>
                    <td>{organizationNames[allocation.organization_id] ?? "機構"}<span className="mt-1 block text-xs">{courseNames[allocation.course_id] ?? "課程"}</span></td>
                    <td><span className="font-mono text-xs">{allocation.learner_id.slice(0, 8)}</span></td>
                    <td>{allocation.live_session_id ? liveSessions.find((session) => session.id === allocation.live_session_id)?.title ?? "既有場次" : "尚未選場"}</td>
                    <td>
                      <select
                        className="field min-w-56"
                        value={sessionByAllocation[allocation.id] ?? ""}
                        onChange={(event) => setSessionByAllocation((current) => ({ ...current, [allocation.id]: event.target.value }))}
                        disabled={readOnly || busy}
                      >
                        <option value="">選擇未來場次</option>
                        {candidates.map((session) => <option key={session.id} value={session.id}>{session.title}・{formatDate(session.starts_at)}</option>)}
                      </select>
                    </td>
                    <td>
                      {!readOnly && <div className="flex min-w-48 flex-wrap gap-2"><button className="button-secondary" disabled={busy || !sessionByAllocation[allocation.id]} onClick={() => void updateAllocation(allocation.id, "select_session")}>人工改場</button><button className="min-h-11 px-3 text-sm font-black text-rose-700" disabled={busy} onClick={() => void updateAllocation(allocation.id, "release")}>釋回</button></div>}
                    </td>
                  </tr>
                );
              })}
              {!activeAllocations.length && <tr><td colSpan={5} className="text-center">尚無待處理指派。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <Header icon={<History />} title="名額帳本與企業稽核" />
        <div className="grid xl:grid-cols-2">
          <MiniTable
            headings={["時間", "事件", "數量"]}
            rows={seatEvents.map((event) => [
              formatDate(event.occurred_at),
              event.event_type,
              event.masked
                ? "已遮罩"
                : `${event.available_delta && event.available_delta > 0 ? "+" : ""}${event.available_delta ?? event.quantity ?? 0}`,
            ])}
            empty="尚無名額異動。"
          />
          <MiniTable
            headings={["時間", "操作", "目標"]}
            rows={audits.map((audit) => [
              formatDate(audit.occurred_at),
              audit.action,
              audit.masked ? audit.target_type : `${audit.target_type} ${audit.target_id?.slice(0, 8) ?? ""}`,
            ])}
            empty="尚無企業稽核事件。"
          />
        </div>
      </section>
    </div>
  );
}

function Header({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="flex items-center gap-3 p-6 text-[#B45309]">{icon}<h2 className="text-lg font-black text-[#302318]">{title}</h2></div>;
}

function MiniTable({ headings, rows, empty }: { headings: string[]; rows: string[][]; empty: string }) {
  return <div className="table-wrap border-t border-[#eadcc9] xl:border-l"><table className="data-table"><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.join("-")}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headings.length} className="text-center">{empty}</td></tr>}</tbody></table></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
}
