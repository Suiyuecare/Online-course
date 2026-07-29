"use client";

import { useState } from "react";
import type { OrganizationLifecycleItem } from "@/application/organization-lifecycle";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

async function changeStatus(input: {
  organizationId: string;
  action: "suspend" | "reactivate";
  reason: string;
}) {
  const stepUpNonce = await obtainStepUp(
    "emergency_suspend",
    input.organizationId,
  );
  const response = await fetch(
    `/api/staff/organizations/${input.organizationId}/status`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        action: input.action,
        reason: input.reason,
        stepUpNonce,
      }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "ORGANIZATION_STATUS_CHANGE_REJECTED");
  }
  return result?.data;
}

function LifecycleCase({ item }: { item: OrganizationLifecycleItem }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const action = item.status === "approved" ? "suspend" : "reactivate";
  const isSuspending = action === "suspend";
  const descriptionId = `organization-lifecycle-${item.organizationId}`;

  return (
    <article className="context-action-form">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {item.status === "approved" ? "正常營運" : "已暫停"}
          </p>
          <h3>{item.legalName}</h3>
        </div>
        <span className={`status ${item.status}`}>
          {item.status === "approved" ? "已核准" : "已停權"}
        </span>
      </div>
      <dl className="compact-data-list">
        <div>
          <dt>聯絡人</dt>
          <dd>{item.contactName}</dd>
        </div>
        <div>
          <dt>發票 Email</dt>
          <dd>{item.invoiceEmail}</dd>
        </div>
        <div>
          <dt>最近異動</dt>
          <dd>{new Date(item.updatedAt).toLocaleString("zh-TW")}</dd>
        </div>
      </dl>
      <p id={descriptionId}>
        {isSuspending
          ? "停權後會立即阻擋新的購點、邀請與派課；既有訂單、學習與稽核紀錄不會刪除。"
          : "復權後才會重新允許購點、邀請與派課；原有稽核紀錄會保留。"}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(
            new FormData(event.currentTarget).get("reason") ?? "",
          ).trim();
          setBusy(true);
          setMessage("請在驗證器 App 完成 fresh TOTP…");
          void changeStatus({
            organizationId: item.organizationId,
            action,
            reason,
          })
            .then(() => {
              setMessage(
                isSuspending
                  ? "機構已停權；正式操作已立即停止。"
                  : "機構已復權；重新整理後即可操作。",
              );
              window.location.reload();
            })
            .catch((error: Error) =>
              setMessage(
                presentErrorCode(
                  error.message,
                  "狀態未變更；請確認平台管理員權限、fresh TOTP、理由與目前狀態。",
                ),
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {isSuspending ? "停權理由" : "復權理由"}
          <textarea
            aria-describedby={descriptionId}
            name="reason"
            minLength={10}
            maxLength={1000}
            required
          />
        </label>
        <button
          className={isSuspending ? "button danger" : "button"}
          disabled={busy}
          type="submit"
        >
          {busy
            ? "驗證並處理中…"
            : isSuspending
              ? "Fresh TOTP 後停權"
              : "Fresh TOTP 後復權"}
        </button>
      </form>
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function OrganizationLifecyclePanel({
  items,
}: {
  items: OrganizationLifecycleItem[];
}) {
  return (
    <section
      className="workspace-section"
      aria-labelledby="org-lifecycle-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">機構生命週期</p>
          <h2 id="org-lifecycle-title">停權與復權</h2>
        </div>
        <span>{items.length} 個機構</span>
      </div>
      <p>
        只有平台管理員可操作，每次都需要 fresh TOTP、至少 10
        字理由、冪等控制與不可覆寫的稽核事件。
      </p>
      {items.length === 0 ? (
        <p className="closed-note">目前沒有已核准或已停權的機構。</p>
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <LifecycleCase item={item} key={item.organizationId} />
          ))}
        </div>
      )}
    </section>
  );
}
