"use client";

import { useState } from "react";
import type { SupportQueue as SupportQueueData } from "@/application/workspace";
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

const statusLabels: Record<string, string> = {
  open: "待處理",
  investigating: "處理中",
  waiting_customer: "等待客戶",
  resolved: "已解決",
  closed: "已結案",
};

const slaLabels: Record<string, string> = {
  complete: "SLA 已完成",
  overdue: "已逾 SLA",
  due_soon: "即將到期",
  on_track: "SLA 正常",
};

export function SupportQueue({ workspace }: { workspace: SupportQueueData }) {
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
            "客服操作未完成；只能由案件承辦人回覆、改狀態或調整 SLA。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="staff-workspace">
      <section className="staff-item-list">
        {workspace.cases.map((supportCase) => (
          <article key={supportCase.caseId}>
            <span>
              {statusLabels[supportCase.status] ?? supportCase.status}・
              {slaLabels[supportCase.slaState]}
            </span>
            <h2>
              {supportCase.reference}・{supportCase.safePreview}
            </h2>
            <p>
              {supportCase.scopeLabel}・{supportCase.requesterLabel}・
              {supportCase.assigned ? "已指派" : "未指派"}
            </p>
            <p>
              回應期限{" "}
              {new Date(supportCase.responseDueAt).toLocaleString("zh-TW")}
            </p>

            <form
              className="single-step-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(
                  () =>
                    post(
                      `/api/staff/support/cases/${supportCase.caseId}/actions`,
                      {
                        action: "assign",
                        assigneeRoleId: form.get("assigneeRoleId"),
                        reason: form.get("reason"),
                      },
                    ),
                  "案件已指派。",
                );
              }}
            >
              <label>
                指派有效客服
                <select name="assigneeRoleId" required defaultValue="">
                  <option disabled value="">
                    請選擇承辦人
                  </option>
                  {workspace.agents.map((agent) => (
                    <option key={agent.roleId} value={agent.roleId}>
                      {agent.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                指派原因
                <input maxLength={2000} minLength={5} name="reason" required />
              </label>
              <button
                className="button secondary"
                disabled={busy || workspace.agents.length === 0}
                type="submit"
              >
                指派案件
              </button>
            </form>

            {!supportCase.canReadThread ? (
              <p className="closed-note">
                這是遮罩佇列。只有目前承辦人能操作回覆、狀態或
                SLA；客戶自由文字不會提供給客服，需另走安全補件流程。
              </p>
            ) : (
              <>
                <div className="support-thread">
                  {supportCase.messages.map((entry) => (
                    <div
                      className={`support-message support-${entry.authorKind}`}
                      key={entry.messageId}
                    >
                      <strong>
                        {entry.authorKind === "support" ? "客服" : "案件提出人"}
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
                    className="single-step-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      run(
                        () =>
                          post(
                            `/api/staff/support/cases/${supportCase.caseId}/actions`,
                            {
                              action: "reply",
                              body: form.get("body"),
                              reason: form.get("reason"),
                            },
                          ),
                        "客服回覆已加入。",
                      );
                    }}
                  >
                    <h3>回覆案件</h3>
                    <label>
                      回覆
                      <textarea
                        maxLength={4000}
                        minLength={1}
                        name="body"
                        required
                      />
                    </label>
                    <label>
                      處理註記
                      <input
                        maxLength={2000}
                        minLength={5}
                        name="reason"
                        required
                      />
                    </label>
                    <button className="button" disabled={busy} type="submit">
                      回覆並等待客戶
                    </button>
                  </form>
                )}
                <form
                  className="single-step-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    run(
                      () =>
                        post(
                          `/api/staff/support/cases/${supportCase.caseId}/actions`,
                          {
                            action: "status",
                            status: form.get("status"),
                            reason: form.get("reason"),
                          },
                        ),
                      "案件狀態已更新。",
                    );
                  }}
                >
                  <h3>狀態</h3>
                  <label>
                    新狀態
                    <select defaultValue={supportCase.status} name="status">
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    異動原因
                    <input
                      maxLength={2000}
                      minLength={5}
                      name="reason"
                      required
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy}
                    type="submit"
                  >
                    更新狀態
                  </button>
                </form>
                {!["resolved", "closed"].includes(supportCase.status) && (
                  <form
                    className="single-step-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const dueAt = new Date(
                        String(form.get("responseDueAt")),
                      ).toISOString();
                      run(
                        () =>
                          post(
                            `/api/staff/support/cases/${supportCase.caseId}/actions`,
                            {
                              action: "sla",
                              responseDueAt: dueAt,
                              reason: form.get("reason"),
                            },
                          ),
                        "SLA 期限已留下事件並更新。",
                      );
                    }}
                  >
                    <h3>SLA</h3>
                    <label>
                      新回應期限（最多延至 15 日內）
                      <input
                        name="responseDueAt"
                        required
                        type="datetime-local"
                      />
                    </label>
                    <label>
                      調整原因
                      <input
                        maxLength={2000}
                        minLength={5}
                        name="reason"
                        required
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy}
                      type="submit"
                    >
                      調整 SLA
                    </button>
                  </form>
                )}
              </>
            )}
          </article>
        ))}
        {workspace.cases.length === 0 && (
          <p className="closed-note">目前沒有客服案件。</p>
        )}
      </section>
      {message && <p aria-live="polite">{message}</p>}
    </div>
  );
}
