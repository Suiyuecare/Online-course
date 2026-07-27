"use client";

import { useState } from "react";
import type { CertificateRevocationWorkspace } from "@/domain/quality-staff";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

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

const certificateKindLabels = {
  completion: "完課證明",
  accreditation: "積分證明",
} as const;

const certificateStatusLabels = {
  active: "有效",
  submitted: "積分送審中",
  credited: "積分已登錄",
  needs_correction: "待補正",
  rejected: "積分未通過",
} as const;

export function CertificateRevocationPanel({
  workspace,
}: {
  workspace: CertificateRevocationWorkspace;
}) {
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "撤銷申請與最終決定都要重新完成 TOTP；申請人不能審核自己的案件。",
  );

  return (
    <>
      <section className="organization-records">
        <section>
          <p className="eyebrow">建立申請</p>
          <h2>申請撤銷證明</h2>
          <p className="muted-copy">
            從可撤銷清單選擇證明。這裡不接受手動貼上資料庫編號。
          </p>
          {workspace.certificateOptions.length === 0 ? (
            <p className="closed-note">目前沒有可建立撤銷申請的證明。</p>
          ) : (
            <form
              className="context-action-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const certificateId = String(form.get("certificateId") ?? "");
                const reason = String(form.get("reason") ?? "");
                setBusyTarget(certificateId);
                void obtainStepUp("certificate_revoke", certificateId)
                  .then((stepUpNonce) =>
                    post("/api/staff/certificates/revocations", {
                      certificateId,
                      reason,
                      stepUpNonce,
                    }),
                  )
                  .then(() => {
                    setMessage("撤銷申請已建立，等待另一位審核員決定。");
                    window.location.reload();
                  })
                  .catch((error: Error) =>
                    setMessage(
                      presentErrorCode(
                        error.message,
                        "撤銷申請未建立；請確認證明狀態與 fresh TOTP。",
                      ),
                    ),
                  )
                  .finally(() => setBusyTarget(null));
              }}
            >
              <label>
                證明
                <select name="certificateId" required defaultValue="">
                  <option value="" disabled>
                    請選擇證明
                  </option>
                  {workspace.certificateOptions.map((certificate) => (
                    <option
                      key={certificate.certificateId}
                      value={certificate.certificateId}
                    >
                      {certificate.courseTitle}／{certificate.learnerLabel}／
                      {certificateKindLabels[certificate.certificateKind]}／
                      {certificateStatusLabels[certificate.currentStatus]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                撤銷理由
                <textarea
                  name="reason"
                  minLength={10}
                  maxLength={1000}
                  required
                />
              </label>
              <button
                className="button"
                disabled={busyTarget !== null}
                type="submit"
              >
                {busyTarget ? "驗證與送出中…" : "Fresh TOTP 後建立申請"}
              </button>
            </form>
          )}
        </section>

        <section>
          <p className="eyebrow">獨立覆核</p>
          <h2>待決定撤銷案件</h2>
          <div className="record-list">
            {workspace.pendingRequests.map((request) => (
              <article key={request.requestId}>
                <strong>
                  {request.courseTitle}／{request.learnerLabel}
                </strong>
                <span>
                  {certificateKindLabels[request.certificateKind]}・
                  {certificateStatusLabels[request.currentStatus]}
                </span>
                <p>申請人：{request.requestedByLabel}</p>
                <p>申請理由：{request.reason}</p>
                <p>
                  建立時間：
                  {new Date(request.createdAt).toLocaleString("zh-TW")}
                </p>
                {request.canDecide ? (
                  <form
                    className="context-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      setBusyTarget(request.requestId);
                      void obtainStepUp("certificate_revoke", request.requestId)
                        .then((stepUpNonce) =>
                          post(
                            `/api/staff/certificates/revocations/${request.requestId}/decision`,
                            {
                              decision: form.get("decision"),
                              reason: form.get("reason"),
                              stepUpNonce,
                            },
                          ),
                        )
                        .then(() => {
                          setMessage("撤銷案件決定已保存。");
                          window.location.reload();
                        })
                        .catch((error: Error) =>
                          setMessage(
                            presentErrorCode(
                              error.message,
                              "決定未保存；申請人不得審核自己的案件。",
                            ),
                          ),
                        )
                        .finally(() => setBusyTarget(null));
                    }}
                  >
                    <label>
                      決定
                      <select name="decision" required defaultValue="">
                        <option value="" disabled>
                          請選擇
                        </option>
                        <option value="approve">核准撤銷</option>
                        <option value="reject">駁回申請</option>
                      </select>
                    </label>
                    <label>
                      覆核理由
                      <textarea
                        name="reason"
                        minLength={10}
                        maxLength={1000}
                        required
                      />
                    </label>
                    <button
                      className="button"
                      disabled={busyTarget !== null}
                      type="submit"
                    >
                      {busyTarget === request.requestId
                        ? "驗證與保存中…"
                        : "Fresh TOTP 後保存決定"}
                    </button>
                  </form>
                ) : (
                  <p className="closed-note">
                    你是本案申請人，必須由另一位積分審核員決定。
                  </p>
                )}
              </article>
            ))}
            {workspace.pendingRequests.length === 0 && (
              <p className="closed-note">目前沒有待決定的撤銷案件。</p>
            )}
          </div>
        </section>
      </section>
      <p aria-live="polite">{message}</p>
    </>
  );
}
