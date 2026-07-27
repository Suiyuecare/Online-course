"use client";

import { useState } from "react";
import type { QuizAttemptInvalidationWorkspace } from "@/application/quiz-attempt-invalidation";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

const attemptStatusLabels: Record<string, string> = {
  submitted: "已送出",
  passed: "已通過",
  failed: "未通過",
  expired: "已逾時",
  voided: "已作廢",
};

const requestStatusLabels: Record<string, string> = {
  pending: "等待第二位審核員",
  pending_review: "等待第二位審核員",
  approved: "已核准作廢",
  rejected: "已拒絕作廢",
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-TW") : "尚未完成";
}

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

export function QuizAttemptInvalidationPanel({
  workspace,
}: {
  workspace: QuizAttemptInvalidationWorkspace;
}) {
  const selectableAttempts = workspace.attempts.filter(
    (attempt) => !attempt.hasOpenRequest && attempt.status !== "voided",
  );
  const [selectedAttemptId, setSelectedAttemptId] = useState(
    selectableAttempts[0]?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("處理中…");
    void task()
      .then(() => {
        setMessage(`${success}，即將重新整理。`);
        window.location.reload();
      })
      .catch((error: Error) => {
        setMessage(
          presentErrorCode(
            error.message,
            "操作未完成；請確認案件仍可處理，並重新完成 TOTP 驗證。",
          ),
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      <div className="warning-panel">
        <strong>作廢只處理整次測驗，不會顯示或修改個別答案</strong>
        <p>
          提案與核准必須由兩位不同的積分審核員完成。核准後會保留原始紀錄與稽核軌跡，但該次成績不再作為完課依據。
        </p>
      </div>

      <section className="single-step-form">
        <h2>提出測驗作廢申請</h2>
        {selectableAttempts.length === 0 ? (
          <p className="closed-note">
            目前沒有可提出作廢的測驗；已有待審案件或已作廢的紀錄不會重複列入。
          </p>
        ) : (
          <form
            className="context-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const quizAttemptId = String(form.get("quizAttemptId"));
              run(
                async () =>
                  post("/api/staff/accreditation/quiz-attempt-invalidations", {
                    quizAttemptId,
                    reason: form.get("reason"),
                    stepUpNonce: await obtainStepUp(
                      "accreditation_result",
                      quizAttemptId,
                    ),
                  }),
                "作廢申請已送交另一位積分審核員",
              );
            }}
          >
            <label>
              選擇測驗紀錄
              <select
                name="quizAttemptId"
                onChange={(event) => setSelectedAttemptId(event.target.value)}
                value={selectedAttemptId}
              >
                {selectableAttempts.map((attempt) => (
                  <option key={attempt.id} value={attempt.id}>
                    {attempt.courseLabel}／{attempt.learnerLabel}／第{" "}
                    {attempt.attemptNumber} 次／
                    {attempt.score === null ? "未計分" : `${attempt.score} 分`}
                  </option>
                ))}
              </select>
            </label>
            {selectableAttempts
              .filter((attempt) => attempt.id === selectedAttemptId)
              .map((attempt) => (
                <div className="status-card status-warning" key={attempt.id}>
                  <strong>
                    {attempt.courseLabel}／{attempt.learnerLabel}
                  </strong>
                  <p>
                    第 {attempt.attemptNumber} 次測驗；狀態：
                    {attemptStatusLabels[attempt.status] ?? attempt.status}
                    ；成績：
                    {attempt.score === null ? "未計分" : `${attempt.score} 分`}
                    ／及格門檻 {attempt.passingScore} 分；送出：
                    {formatDate(attempt.submittedAt)}
                  </p>
                </div>
              ))}
            <label>
              申請理由（學員可看到此理由）
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              Fresh TOTP 後送交覆核
            </button>
          </form>
        )}
      </section>

      <section className="single-step-form">
        <h2>作廢案件與第二人覆核</h2>
        {workspace.requests.length === 0 && (
          <p className="closed-note">目前沒有測驗作廢案件。</p>
        )}
        {workspace.requests.map((request) => {
          const pending =
            request.status === "pending" || request.status === "pending_review";
          return (
            <form
              className="context-action-form"
              key={request.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const decision = String(form.get("decision"));
                run(
                  async () =>
                    post(
                      `/api/staff/accreditation/quiz-attempt-invalidations/${request.id}/decision`,
                      {
                        decision,
                        reason: form.get("reason"),
                        stepUpNonce: await obtainStepUp(
                          "accreditation_result",
                          request.id,
                        ),
                      },
                    ),
                  decision === "approve"
                    ? "該次測驗已核准作廢"
                    : "作廢申請已拒絕",
                );
              }}
            >
              <strong>
                {request.courseLabel}／{request.learnerLabel}／第{" "}
                {request.attemptNumber} 次
              </strong>
              <p>
                成績：
                {request.score === null ? "未計分" : `${request.score} 分`}
                ；案件：
                {requestStatusLabels[request.status] ?? request.status}
              </p>
              <p>
                申請人：{request.requesterLabel}；申請時間：
                {formatDate(request.requestedAt)}
              </p>
              <p>申請理由：{request.requestReason}</p>
              {request.decidedAt && (
                <p>
                  覆核人：{request.decidedByLabel ?? "已遮罩"}；覆核時間：
                  {formatDate(request.decidedAt)}
                  ；覆核理由：{request.decisionReason ?? "未提供"}
                </p>
              )}
              {pending && request.canReview ? (
                <>
                  <label>
                    覆核結果
                    <select defaultValue="approve" name="decision">
                      <option value="approve">核准作廢</option>
                      <option value="reject">拒絕作廢</option>
                    </select>
                  </label>
                  <label>
                    覆核理由（學員可看到此理由）
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy} type="submit">
                    Fresh TOTP 後送出決定
                  </button>
                </>
              ) : pending ? (
                <p className="closed-note">
                  提案人不能核准自己的案件，請由另一位積分審核員完成覆核。
                </p>
              ) : null}
            </form>
          );
        })}
      </section>

      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
