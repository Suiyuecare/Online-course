"use client";

import { useState } from "react";
import {
  BadgeDollarSign,
  Building2,
  LoaderCircle,
  ReceiptText,
  RotateCw,
  ShieldCheck,
} from "lucide-react";

export type EnterpriseAdminOrganization = {
  id: string;
  name: string;
  tax_id?: string | null;
  status: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  invoice_email?: string | null;
  review_note?: string | null;
  created_at: string;
  masked?: boolean;
};

export type EnterpriseAdminCourse = {
  id: string;
  title: string;
  delivery: string;
  status: string;
};

export type EnterpriseAdminTier = {
  id: string;
  course_id: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_price_twd: number;
  effective_at: string;
  expires_at: string | null;
  active: boolean;
};

export type EnterpriseAdminInvoice = {
  id: string;
  organization_id: string;
  order_id: string;
  refund_id?: string | null;
  record_type?: "invoice" | "allowance" | "void";
  status: string;
  amount_twd: number;
  invoice_number?: string | null;
  allowance_number?: string | null;
  allowance_status?: string | null;
  allowance_expires_at?: string | null;
  allowance_manual_reconciliation_required?: boolean;
  attempt_count: number;
  error_message?: string | null;
  created_at: string;
  masked?: boolean;
};

export type EnterpriseAdminRefund = {
  id: string;
  order_id: string;
  amount_twd: number;
  status: string;
  reason: string;
  seat_quantity?: number | null;
  created_at: string;
  masked?: boolean;
};

export function AdminEnterpriseManager({
  organizations,
  courses,
  tiers,
  invoices,
  refunds,
  enabled,
  readOnly,
}: {
  organizations: EnterpriseAdminOrganization[];
  courses: EnterpriseAdminCourse[];
  tiers: EnterpriseAdminTier[];
  invoices: EnterpriseAdminInvoice[];
  refunds: EnterpriseAdminRefund[];
  enabled: boolean;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    readOnly ? "客服模式：可查看狀態，但不能審核、改價、退費或重試開票。" : "",
  );

  async function request(
    url: string,
    options: RequestInit,
    successMessage: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, options);
      const result = (await response.json().catch(() => null)) as
        | { error?: string; reason?: string }
        | null;
      if (!response.ok) {
        setMessage(result?.reason || result?.error || "操作失敗，請檢查資料。");
        return;
      }
      setMessage(successMessage);
      window.location.reload();
    } catch {
      setMessage("網路連線失敗，請稍後重試；本次操作尚未確認完成。");
    } finally {
      setBusy(false);
    }
  }

  async function review(
    organizationId: string,
    decision: "approved" | "rejected" | "suspended",
  ) {
    const reason =
      decision === "approved"
        ? undefined
        : window.prompt("請填寫原因（至少 5 個字），此內容會寄給機構管理者：") ||
          undefined;
    if (decision !== "approved" && (!reason || reason.length < 5)) return;
    await request(
      `/api/admin/enterprise/organizations/${organizationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      },
      decision === "approved" ? "機構已核准。" : "機構狀態已更新。",
    );
  }

  async function addTier(formData: FormData) {
    const expiresAt = String(formData.get("expiresAt") ?? "");
    await request(
      "/api/admin/enterprise/pricing",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId: formData.get("courseId"),
          minQuantity: Number(formData.get("minQuantity")),
          maxQuantity: formData.get("maxQuantity")
            ? Number(formData.get("maxQuantity"))
            : null,
          unitPriceTwd: Number(formData.get("unitPriceTwd")),
          effectiveAt: new Date(String(formData.get("effectiveAt"))).toISOString(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      },
      "企業級距售價已新增。",
    );
  }

  async function deactivateTier(tier: EnterpriseAdminTier) {
    if (!window.confirm("確定停用這個企業售價級距？既有訂單快照不受影響。"))
      return;
    await request(
      `/api/admin/enterprise/pricing?id=${encodeURIComponent(tier.id)}`,
      { method: "DELETE" },
      "企業級距售價已停用。",
    );
  }

  async function decideRefund(
    refundId: string,
    decision: "approved" | "rejected" | "paid" | "retry_allowance",
  ) {
    const reason = window.prompt(
      decision === "paid"
        ? "請填寫已完成退款的說明（至少 5 個字）："
        : decision === "retry_allowance"
          ? "請填寫折讓重試原因（至少 5 個字）："
          : "請填寫審核原因（至少 5 個字）：",
    );
    if (!reason || reason.trim().length < 5) return;
    const providerRefundId =
      decision === "paid"
        ? window.prompt("請填入綠界／銀行退款參考編號：")
        : undefined;
    if (decision === "paid" && (!providerRefundId || providerRefundId.length < 3))
      return;
    await request(
      `/api/admin/enterprise/refunds/${refundId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason, providerRefundId }),
      },
      decision === "paid"
        ? "退款已登錄，電子發票折讓通知已啟動。"
        : decision === "retry_allowance"
          ? "電子發票折讓已重新送出。"
        : "退費審核已更新。",
    );
  }

  async function reconcileAllowance(
    invoice: EnterpriseAdminInvoice,
    outcome: "confirmed_not_issued" | "confirmed_issued",
  ) {
    if (!invoice.refund_id) return;
    const reason = window.prompt(
      "請填寫人工對帳原因（至少 5 個字）：",
    )?.trim();
    if (!reason || reason.length < 5) return;
    const evidence = window.prompt(
      "請填寫綠界後台／客服查核依據（至少 3 個字）：",
    )?.trim();
    if (!evidence || evidence.length < 3) return;
    const payload: Record<string, unknown> = {
      decision:
        outcome === "confirmed_issued"
          ? "reconcile_allowance_issued"
          : "reconcile_allowance_not_issued",
      reason,
      evidence,
    };
    if (outcome === "confirmed_issued") {
      const invoiceNumber = window.prompt("原發票號碼（2 碼英文＋8 碼數字）：")
        ?.trim()
        .toUpperCase();
      const allowanceNumber = window.prompt("綠界 16 碼折讓單號：")?.trim();
      const allowanceDate = window.prompt(
        "折讓成立時間（例如 2026-07-20 14:30）：",
      )?.trim();
      const remainingText = window.prompt("折讓後剩餘可折讓金額：")?.trim();
      const allowanceAt = allowanceDate ? new Date(allowanceDate) : null;
      const remainingAmountTwd = Number(remainingText);
      if (
        !invoiceNumber ||
        !allowanceNumber ||
        !allowanceAt ||
        Number.isNaN(allowanceAt.getTime()) ||
        !Number.isInteger(remainingAmountTwd) ||
        remainingAmountTwd < 0
      ) {
        setMessage("人工對帳資料格式不正確。");
        return;
      }
      Object.assign(payload, {
        invoiceNumber,
        allowanceNumber,
        allowanceAt: allowanceAt.toISOString(),
        remainingAmountTwd,
      });
    }
    await request(
      `/api/admin/enterprise/refunds/${invoice.refund_id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      outcome === "confirmed_issued"
        ? "折讓已依綠界查核結果補登。"
        : "已確認未開立，可重新送出折讓。",
    );
  }

  return (
    <div className="space-y-7">
      <p
        className={`min-h-6 text-sm font-bold ${message.includes("失敗") ? "text-rose-700" : "text-emerald-700"}`}
        role="status"
      >
        {busy && <LoaderCircle className="mr-2 inline size-4 animate-spin" />}
        {message}
      </p>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-3 p-6">
          <Building2 className="text-[#B45309]" />
          <div>
            <h2 className="text-lg font-black text-[#302318]">機構首次審核</h2>
            <p className="mt-1 text-sm text-slate-500">
              統編重複由客服確認；核准後機構才可購買、邀請及指派。
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>機構</th>
                <th>聯絡資料</th>
                <th>申請日期</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id}>
                  <td>
                    <strong>{organization.name}</strong>
                    <span className="mt-1 block text-xs">
                      {organization.masked
                        ? "統編已遮罩"
                        : `統編 ${organization.tax_id || "未填"}`}
                    </span>
                  </td>
                  <td>
                    {organization.masked
                      ? "聯絡資料已遮罩"
                      : `${organization.contact_name || "—"}・${organization.contact_phone || "—"}`}
                    <span className="mt-1 block text-xs">
                      {organization.masked
                        ? "Email 已遮罩"
                        : organization.invoice_email || "未填 Email"}
                    </span>
                  </td>
                  <td>{formatDate(organization.created_at)}</td>
                  <td>
                    <Status value={organization.status} />
                    {organization.review_note && (
                      <span className="mt-1 block max-w-52 text-xs text-rose-700">
                        {organization.review_note}
                      </span>
                    )}
                  </td>
                  <td>
                    {!readOnly && (
                      <div className="flex min-w-52 flex-wrap gap-2">
                        {organization.status !== "approved" && (
                          <button
                            type="button"
                            className="min-h-11 text-sm font-black text-emerald-700"
                            disabled={busy}
                            onClick={() => void review(organization.id, "approved")}
                          >
                            核准
                          </button>
                        )}
                        {organization.status === "submitted" && (
                          <button
                            type="button"
                            className="min-h-11 text-sm font-black text-rose-700"
                            disabled={busy}
                            onClick={() => void review(organization.id, "rejected")}
                          >
                            退回
                          </button>
                        )}
                        {organization.status === "approved" && (
                          <button
                            type="button"
                            className="min-h-11 text-sm font-black text-rose-700"
                            disabled={busy}
                            onClick={() => void review(organization.id, "suspended")}
                          >
                            停權
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {organizations.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center">
                    尚無機構申請。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-[380px_1fr]">
        <section className="panel p-6">
          <div className="flex items-center gap-3">
            <BadgeDollarSign className="text-[#B45309]" />
            <h2 className="text-lg font-black text-[#302318]">新增級距售價</h2>
          </div>
          <form action={addTier} className="mt-5 grid gap-4">
            <Field label="課程">
              <select name="courseId" className="field" required>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}（{course.delivery === "live" ? "直播" : "錄播"}）
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="最少數量">
                <input className="field" name="minQuantity" type="number" min="1" required />
              </Field>
              <Field label="最多數量">
                <input className="field" name="maxQuantity" type="number" min="1" placeholder="無上限" />
              </Field>
            </div>
            <Field label="每名單價（NT$）">
              <input className="field" name="unitPriceTwd" type="number" min="1" required />
            </Field>
            <Field label="生效時間">
              <input className="field" name="effectiveAt" type="datetime-local" required />
            </Field>
            <Field label="失效時間（選填）">
              <input className="field" name="expiresAt" type="datetime-local" />
            </Field>
            <button className="button-primary" disabled={!enabled || busy || courses.length === 0}>
              儲存級距售價
            </button>
          </form>
        </section>

        <section className="panel overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-black text-[#302318]">目前售價級距</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>課程</th><th>數量</th><th>單價</th><th>生效</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td>{courses.find((course) => course.id === tier.course_id)?.title ?? "課程"}</td>
                    <td>{tier.min_quantity}–{tier.max_quantity ?? "以上"}</td>
                    <td>NT$ {tier.unit_price_twd.toLocaleString("zh-TW")}</td>
                    <td>{formatDate(tier.effective_at)}</td>
                    <td><Status value={tier.active ? "active" : "archived"} /></td>
                    <td>
                      {!readOnly && tier.active ? (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={!enabled || busy}
                          onClick={() => void deactivateTier(tier)}
                        >
                          停用
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {tiers.length === 0 && <tr><td colSpan={6} className="text-center">尚未設定企業售價。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-3 p-6">
          <ReceiptText className="text-[#B45309]" />
          <div>
            <h2 className="text-lg font-black text-[#302318]">發票與營運異常</h2>
            <p className="mt-1 text-sm text-slate-500">
              開票失敗不撤銷已付款名額；排程與人工重試都使用同一冪等鍵。
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>建立日期</th><th>機構</th><th>金額</th><th>發票</th><th>錯誤</th><th>操作</th></tr></thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{formatDate(invoice.created_at)}</td>
                  <td>{organizations.find((item) => item.id === invoice.organization_id)?.name ?? "機構"}</td>
                  <td>
                    {invoice.masked
                      ? "已遮罩"
                      : `NT$ ${invoice.amount_twd.toLocaleString("zh-TW")}`}
                  </td>
                  <td>
                    <Status value={invoice.allowance_status || invoice.status} />
                    {!invoice.masked &&
                      (invoice.invoice_number || invoice.allowance_number) && (
                      <span className="mt-1 block text-xs">
                        {invoice.invoice_number || invoice.allowance_number}
                      </span>
                    )}
                  </td>
                  <td><span className="block max-w-xs text-xs text-rose-700">{invoice.error_message || "—"}</span></td>
                  <td>
                    {!readOnly &&
                      (invoice.record_type ?? "invoice") === "invoice" &&
                      ["pending", "failed"].includes(invoice.status) && (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => void request(`/api/admin/enterprise/invoices/${invoice.id}/retry`, { method: "POST" }, "開票重試完成。")}
                      >
                        <RotateCw className="size-4" />
                        {invoice.attempt_count >= 5 ? "人工補開" : "重試"}
                      </button>
                    )}
                    {!readOnly &&
                      invoice.record_type === "allowance" &&
                      invoice.refund_id &&
                      ["none", "failed"].includes(
                        invoice.allowance_status ?? "",
                      ) && (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void decideRefund(
                              invoice.refund_id!,
                              "retry_allowance",
                            )
                          }
                        >
                          <RotateCw className="size-4" /> 重試折讓
                        </button>
                      )}
                    {!readOnly &&
                      invoice.record_type === "allowance" &&
                      invoice.refund_id &&
                      allowanceNeedsReconciliation(invoice) && (
                        <div className="flex min-w-52 flex-wrap gap-2">
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={busy}
                            onClick={() =>
                              void reconcileAllowance(
                                invoice,
                                "confirmed_not_issued",
                              )
                            }
                          >
                            確認未開立
                          </button>
                          <button
                            type="button"
                            className="min-h-11 px-3 text-sm font-black text-emerald-700"
                            disabled={busy}
                            onClick={() =>
                              void reconcileAllowance(
                                invoice,
                                "confirmed_issued",
                              )
                            }
                          >
                            補登已開立
                          </button>
                        </div>
                      )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={6} className="text-center">尚無企業發票。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-3 p-6 pb-0">
          <ShieldCheck className="text-[#B45309]" />
          <div>
            <h2 className="text-lg font-black text-[#302318]">人工退費佇列</h2>
            <p className="mt-1 text-sm text-slate-500">
              只接受未觀看、未簽到及未發證名額；折讓在退款完成後建立。
            </p>
          </div>
        </div>
        <div className="table-wrap mt-5">
          <table className="data-table">
            <thead>
              <tr><th>申請日期</th><th>數量</th><th>金額</th><th>原因</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.id}>
                  <td>{formatDate(refund.created_at)}</td>
                  <td>{refund.seat_quantity ?? "—"}</td>
                  <td>
                    {refund.masked
                      ? "已遮罩"
                      : `NT$ ${refund.amount_twd.toLocaleString("zh-TW")}`}
                  </td>
                  <td>
                    <span className="block max-w-xs">
                      {refund.masked ? "內容已遮罩" : refund.reason}
                    </span>
                  </td>
                  <td><Status value={refund.status} /></td>
                  <td>
                    {!readOnly && (
                      <div className="flex min-w-52 flex-wrap gap-2">
                        {refund.status === "manual_review" && (
                          <>
                            <button type="button" className="min-h-11 text-sm font-black text-emerald-700" disabled={busy} onClick={() => void decideRefund(refund.id, "approved")}>核准</button>
                            <button type="button" className="min-h-11 text-sm font-black text-rose-700" disabled={busy} onClick={() => void decideRefund(refund.id, "rejected")}>駁回</button>
                          </>
                        )}
                        {refund.status === "approved" && (
                          <button type="button" className="button-secondary" disabled={busy} onClick={() => void decideRefund(refund.id, "paid")}>登錄已退款</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {refunds.length === 0 && <tr><td colSpan={6} className="text-center">尚無退費申請。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-black text-[#493625]"><span>{label}</span>{children}</label>;
}

function Status({ value }: { value: string }) {
  const good = ["approved", "active", "issued", "paid"].includes(value);
  const bad = ["rejected", "suspended", "failed", "archived"].includes(value);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${good ? "bg-emerald-100 text-emerald-800" : bad ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"}`}>{value}</span>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(date);
}

function allowanceNeedsReconciliation(invoice: EnterpriseAdminInvoice) {
  if (invoice.allowance_manual_reconciliation_required) return true;
  if (invoice.allowance_status === "ambiguous") return true;
  return (
    invoice.allowance_status === "pending_consent" &&
    Boolean(invoice.allowance_expires_at) &&
    Date.parse(invoice.allowance_expires_at!) <= Date.now()
  );
}
