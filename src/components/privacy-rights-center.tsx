"use client";

import { useState } from "react";
import type { SupportCenter } from "@/application/workspace";
import {
  privacyRequestOptions,
  type PrivacyRequestType,
} from "@/domain/privacy-rights";
import { presentErrorCode } from "@/domain/presentation";

const statusLabels: Record<string, string> = {
  open: "已收到",
  investigating: "處理中",
  waiting_customer: "等待你補充",
  resolved: "已完成",
  closed: "已結案",
};

async function submitRequest(body: unknown) {
  const response = await fetch("/api/privacy/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "REQUEST_REJECTED");
  return result?.data;
}

export function PrivacyRightsCenter({
  cases,
}: {
  cases: SupportCenter["cases"];
}) {
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <div className="privacy-rights-center">
      <section aria-labelledby="privacy-request-types">
        <h2 id="privacy-request-types">選擇想辦理的事項</h2>
        <div className="privacy-request-options">
          {privacyRequestOptions.map((option) => (
            <label
              className={requestType === option.value ? "is-selected" : ""}
              key={option.value}
            >
              <input
                checked={requestType === option.value}
                name="privacyRequestType"
                onChange={() => setRequestType(option.value)}
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <form
        className="single-step-form privacy-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("正在安全送出…");
          void submitRequest({
            requestType,
            detail: form.get("detail"),
            acknowledged: form.get("acknowledged") === "on",
          })
            .then(() => {
              setMessage("申請已建立；重新整理後可在下方查看案件編號。");
              window.location.reload();
            })
            .catch((error: Error) =>
              setMessage(
                presentErrorCode(
                  error.message,
                  "申請尚未送出，請保留畫面後稍後再試，或由客服協助建立案件。",
                ),
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <h2>說明你的需求</h2>
        <p className="closed-note">
          請勿在這裡輸入完整身分證字號、銀行帳號、密碼或驗證碼。需要核對身分時，客服會另提供受保護的補件方式。
        </p>
        <label>
          希望我們協助的內容
          <textarea
            maxLength={2000}
            minLength={10}
            name="detail"
            placeholder="例如：我想知道平台目前保存哪些學習與訂單資料，以及各自的保存期限。"
            required
          />
        </label>
        <label className="privacy-request-confirmation">
          <input name="acknowledged" required type="checkbox" />
          <span>
            我了解提出帳號刪除或停用申請，不代表訂單、付款、積分、證明及稽核資料會立即消失；客服會逐項說明可刪除、限制利用或依法保留的範圍。
          </span>
        </label>
        <button className="button" disabled={busy} type="submit">
          {busy ? "送出中…" : "建立個資權利申請"}
        </button>
        {message && <p aria-live="polite">{message}</p>}
      </form>

      <section aria-labelledby="privacy-request-history">
        <h2 id="privacy-request-history">我的申請紀錄</h2>
        {cases.length === 0 ? (
          <div className="empty-state compact">
            <strong>目前沒有個資權利申請</strong>
            <p>新申請送出後會顯示案件編號、狀態與回覆期限。</p>
          </div>
        ) : (
          <div className="privacy-request-history">
            {cases.map((item) => (
              <article key={item.caseId}>
                <span>{statusLabels[item.status] ?? item.status}</span>
                <h3>
                  {item.reference}・{item.summary}
                </h3>
                <p>
                  回覆期限{" "}
                  {new Date(item.responseDueAt).toLocaleString("zh-TW")}
                </p>
                {item.messages.at(-1) && (
                  <small>
                    最近更新：
                    {new Date(
                      item.messages.at(-1)?.createdAt ?? item.updatedAt,
                    ).toLocaleString("zh-TW")}
                  </small>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
