"use client";

import { useState } from "react";
import type { SupportCenter as SupportCenterData } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
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

const kindLabels: Record<string, string> = {
  learning: "學習與進度",
  live: "直播課程",
  order: "訂單與匯款狀態",
  organization: "機構培訓",
  account: "帳號登入",
  privacy: "個資與帳號權利",
  other: "其他",
};

const statusLabels: Record<string, string> = {
  open: "待客服處理",
  investigating: "處理中",
  waiting_customer: "等待你的回覆",
  resolved: "已解決",
  closed: "已結案",
};

export function SupportCenter({ workspace }: { workspace: SupportCenterData }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("處理中…");
    void operation()
      .then(() => {
        setMessage(success);
        window.location.reload();
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "客服案件未送出，請稍後再試；案件不會改變積分、付款或完課資格。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const scope = String(form.get("scope") ?? "");
          run(
            () =>
              post("/api/support/cases", {
                kind: form.get("kind"),
                summary: form.get("summary"),
                initialMessage: form.get("initialMessage"),
                organizationId: scope || null,
              }),
            "客服案件已建立。",
          );
        }}
      >
        <h2>建立客服案件</h2>
        <p className="closed-note">
          請勿輸入身分證號、照服員證號、銀行帳號、測驗答案或問卷文字。系統會遮罩疑似證號與長數字；客服也無權讀取這些原始資料或更改資格。
        </p>
        <label>
          案件範圍
          <select defaultValue="" name="scope">
            <option value="">個人案件</option>
            {workspace.organizationOptions.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          類型
          <select defaultValue="learning" name="kind">
            {Object.entries(kindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          主旨
          <input maxLength={200} minLength={5} name="summary" required />
        </label>
        <label>
          問題說明
          <textarea
            maxLength={4000}
            minLength={1}
            name="initialMessage"
            required
          />
        </label>
        <button className="button" disabled={busy} type="submit">
          送出客服案件
        </button>
      </form>

      <section>
        <h2>我的客服案件</h2>
        <div className="record-list">
          {workspace.cases.map((supportCase) => (
            <article key={supportCase.caseId}>
              <span>
                {statusLabels[supportCase.status] ?? supportCase.status}
              </span>
              <h3>
                {supportCase.reference}・{supportCase.summary}
              </h3>
              <p>
                {kindLabels[supportCase.kind] ?? "其他"}・
                {supportCase.organizationScoped ? "機構案件" : "個人案件"}・
                預計回應期限{" "}
                {new Date(supportCase.responseDueAt).toLocaleString("zh-TW")}
              </p>
              <div className="support-thread">
                {supportCase.messages.map((entry) => (
                  <div
                    className={`support-message support-${entry.authorKind}`}
                    key={entry.messageId}
                  >
                    <strong>
                      {entry.authorKind === "support" ? "客服" : "你／機構窗口"}
                    </strong>
                    <p>{entry.body}</p>
                    <small>
                      {new Date(entry.createdAt).toLocaleString("zh-TW")}
                    </small>
                  </div>
                ))}
              </div>
              {supportCase.status !== "closed" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    run(
                      () =>
                        post(
                          `/api/support/cases/${supportCase.caseId}/messages`,
                          { body: form.get("body") },
                        ),
                      "回覆已加入案件。",
                    );
                  }}
                >
                  <label>
                    追加訊息
                    <textarea
                      maxLength={4000}
                      minLength={1}
                      name="body"
                      required
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy}
                    type="submit"
                  >
                    送出回覆
                  </button>
                </form>
              )}
            </article>
          ))}
          {workspace.cases.length === 0 && (
            <p className="closed-note">目前沒有客服案件。</p>
          )}
        </div>
      </section>
      {message && <p aria-live="polite">{message}</p>}
    </div>
  );
}
