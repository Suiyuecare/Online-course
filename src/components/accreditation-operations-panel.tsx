"use client";

import { useState } from "react";
import type { AccreditationOperationsWorkspace } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

const accreditationStatusLabels: Record<string, string> = {
  applying: "申請中",
  approved: "已核定",
  rejected: "未核定",
  expired: "已到期",
  revoked: "已撤銷",
};

const batchStatusLabels: Record<string, string> = {
  draft: "資格預覽草稿",
  approved: "已核准匯出",
  exported: "已產生送審檔",
  submitted: "已送主管機關",
  accepted: "全部認列",
  needs_correction: "部分待補正",
  rejected: "未認列",
};

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

function asIso(value: FormDataEntryValue | null) {
  return new Date(String(value)).toISOString();
}

function allowedTransitions(status: string) {
  if (status === "applying") {
    return [
      ["approved", "核定通過"],
      ["rejected", "核定不通過"],
      ["expired", "申請已到期"],
    ] as const;
  }
  if (status === "approved") {
    return [
      ["expired", "核定已到期"],
      ["revoked", "撤銷核定"],
    ] as const;
  }
  return [];
}

export function AccreditationOperationsPanel({
  workspace,
}: {
  workspace: AccreditationOperationsWorkspace;
}) {
  const firstCourseVersion =
    workspace.batchCourseOptions[0]?.courseVersionId ?? "";
  const [selectedCourseVersion, setSelectedCourseVersion] =
    useState(firstCourseVersion);
  const [selectedCorrectionBatchId, setSelectedCorrectionBatchId] =
    useState("");
  const [transitionStatuses, setTransitionStatuses] = useState<
    Record<string, string>
  >({});
  const [retroactiveSelections, setRetroactiveSelections] = useState<
    Record<string, boolean>
  >({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedBatchCourse =
    workspace.batchCourseOptions.find(
      (option) => option.courseVersionId === selectedCourseVersion,
    ) ?? workspace.batchCourseOptions[0];
  const correctionSources = workspace.batches.filter(
    (batch) => batch.canCreateCorrection,
  );
  const selectedCorrectionBatch = workspace.batches.find(
    (batch) => batch.id === selectedCorrectionBatchId,
  );
  const batchCourseForCreate = selectedCorrectionBatch
    ? workspace.batchCourseOptions.find(
        (option) =>
          option.courseVersionId === selectedCorrectionBatch.courseVersionId,
      )
    : selectedBatchCourse;

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
            "操作未完成；請確認案件狀態、資料內容與雙人覆核。",
          ),
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      <div className="warning-panel">
        <strong>完課不等於主管機關已認列積分</strong>
        <p>
          核定、到期與撤銷都會建立不可變
          revision，且建立者不能核准自己的變更。送審批次則必須依序完成資格預覽、第二人匯出、標記送出與另一位人員回填結果。
        </p>
      </div>

      <section className="single-step-form">
        <h2>課程積分核定狀態</h2>
        {workspace.revisions.length === 0 && (
          <p className="closed-note">
            尚無積分申請資料；請先到平台先決資料建立 applying revision。
          </p>
        )}
        {workspace.revisions.map((revision) => {
          const transitions = allowedTransitions(revision.status);
          const selectedStatus =
            transitionStatuses[revision.id] ?? transitions[0]?.[0] ?? "";
          return (
            <form
              className="context-action-form"
              key={revision.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const requestedStatus = String(form.get("requestedStatus"));
                const common = {
                  requestedStatus,
                  effectiveAt: asIso(form.get("effectiveAt")),
                  sourceDocumentPath: form.get("sourceDocumentPath"),
                  sourceDocumentSha256: form.get("sourceDocumentSha256"),
                  reason: form.get("reason"),
                };
                const payload =
                  requestedStatus === "approved"
                    ? {
                        ...common,
                        approvalReference: form.get("approvalReference"),
                        points: Number(form.get("points")),
                        validFrom: asIso(form.get("validFrom")),
                        validUntil: asIso(form.get("validUntil")),
                        retroactive: Boolean(
                          retroactiveSelections[revision.id],
                        ),
                        retroactiveBasis:
                          String(form.get("retroactiveBasis") ?? "").trim() ||
                          null,
                      }
                    : common;
                run(
                  () =>
                    post(
                      `/api/staff/accreditation/revisions/${revision.id}/transitions`,
                      payload,
                    ),
                  "積分狀態變更已送交另一位積分審核員",
                );
              }}
            >
              <strong>
                {revision.courseLabel}／revision {revision.revision}
              </strong>
              <p>
                狀態：
                {accreditationStatusLabels[revision.status] ?? revision.status}
                ；申請字號：{revision.applicationReference ?? "未填"}
                ；核定字號：{revision.approvalReference ?? "尚未核定"}
                ；積分：{revision.points ?? "尚未核定"}
              </p>
              {revision.retroactive && (
                <p className="success-note">本 revision 為追溯核定。</p>
              )}
              {revision.canRequestTransition && transitions.length > 0 ? (
                <>
                  <label>
                    變更結果
                    <select
                      name="requestedStatus"
                      onChange={(event) =>
                        setTransitionStatuses((current) => ({
                          ...current,
                          [revision.id]: event.target.value,
                        }))
                      }
                      value={selectedStatus}
                    >
                      {transitions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedStatus === "approved" && (
                    <>
                      <label>
                        核定字號
                        <input
                          name="approvalReference"
                          minLength={2}
                          maxLength={200}
                          required
                        />
                      </label>
                      <label>
                        核定積分
                        <input
                          name="points"
                          min="0.01"
                          max="9999.99"
                          step="0.01"
                          type="number"
                          required
                        />
                      </label>
                      <label>
                        核定適用起始
                        <input
                          name="validFrom"
                          type="datetime-local"
                          required
                        />
                      </label>
                      <label>
                        核定適用截止
                        <input
                          name="validUntil"
                          type="datetime-local"
                          required
                        />
                      </label>
                      <label>
                        <span>
                          <input
                            checked={Boolean(
                              retroactiveSelections[revision.id],
                            )}
                            name="retroactive"
                            onChange={(event) =>
                              setRetroactiveSelections((current) => ({
                                ...current,
                                [revision.id]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />{" "}
                          追溯核定既有合格訂單
                        </span>
                      </label>
                      <label>
                        追溯依據（勾選追溯時必填）
                        <textarea
                          name="retroactiveBasis"
                          maxLength={1000}
                          minLength={10}
                          required={Boolean(retroactiveSelections[revision.id])}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    狀態生效時間
                    <input name="effectiveAt" type="datetime-local" required />
                  </label>
                  <label>
                    主管機關文件私有路徑
                    <input name="sourceDocumentPath" maxLength={500} required />
                  </label>
                  <label>
                    文件 SHA-256
                    <input
                      autoComplete="off"
                      name="sourceDocumentSha256"
                      pattern="[a-f0-9]{64}"
                      required
                    />
                  </label>
                  <label>
                    提案理由
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy} type="submit">
                    送交第二位積分審核員
                  </button>
                </>
              ) : (
                <p className="closed-note">
                  此 revision 目前沒有可提案的下一步，或已有案件待覆核。
                </p>
              )}
            </form>
          );
        })}
      </section>

      <section className="single-step-form">
        <h2>待覆核積分狀態變更</h2>
        {workspace.transitionRequests.length === 0 && (
          <p className="closed-note">目前沒有待覆核變更。</p>
        )}
        {workspace.transitionRequests.map((request) => (
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
                    `/api/staff/accreditation/transitions/${request.id}/decision`,
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
                  ? "積分狀態 revision 已核准並套用"
                  : "積分狀態變更已拒絕",
              );
            }}
          >
            <strong>
              {request.courseLabel}：
              {accreditationStatusLabels[request.requestedStatus] ??
                request.requestedStatus}
            </strong>
            <p>
              申請人：{request.requesterLabel}；生效：
              {new Date(request.effectiveAt).toLocaleString("zh-TW")}
            </p>
            {request.requestedStatus === "approved" && (
              <p>
                核定字號：{request.approvalReference}；積分：
                {request.points}；適用：
                {request.validFrom
                  ? new Date(request.validFrom).toLocaleString("zh-TW")
                  : "未填"}
                至
                {request.validUntil
                  ? new Date(request.validUntil).toLocaleString("zh-TW")
                  : "未填"}
                ；追溯：{request.retroactive ? "是" : "否"}
              </p>
            )}
            <p>
              來源：{request.sourceDocumentPath}／SHA-256：
              {request.sourceDocumentSha256}
            </p>
            <p>提案理由：{request.requestReason}</p>
            {request.canDecide ? (
              <>
                <label>
                  覆核理由
                  <textarea
                    name="reason"
                    minLength={10}
                    maxLength={1000}
                    required
                  />
                </label>
                <div className="page-actions">
                  <button
                    className="button"
                    disabled={busy}
                    name="decision"
                    type="submit"
                    value="approve"
                  >
                    Fresh TOTP 後核准
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    name="decision"
                    type="submit"
                    value="reject"
                  >
                    Fresh TOTP 後拒絕
                  </button>
                </div>
              </>
            ) : (
              <p className="closed-note">提案人不可覆核自己的變更。</p>
            )}
          </form>
        ))}
      </section>

      {workspace.canCreateBatch && (
        <form
          className="single-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!batchCourseForCreate) return;
            const form = new FormData(event.currentTarget);
            run(
              () =>
                post("/api/staff/accreditation/batches", {
                  courseVersionId: batchCourseForCreate.courseVersionId,
                  accreditationRevisionId:
                    batchCourseForCreate.accreditationRevisionId,
                  liveSessionId: selectedCorrectionBatch
                    ? selectedCorrectionBatch.liveSessionId
                    : String(form.get("liveSessionId") ?? "") || null,
                  templateVersion: form.get("templateVersion"),
                  supersedesBatchId: selectedCorrectionBatch?.id ?? null,
                }),
              selectedCorrectionBatch
                ? "補正送審批次已建立"
                : "送審資格預覽批次已建立",
            );
          }}
        >
          <h2>建立單一課程／場次送審批次</h2>
          {workspace.batchCourseOptions.length === 0 ? (
            <p className="closed-note">
              目前沒有「已發布且核定有效」的課程可建立批次。
            </p>
          ) : (
            <>
              <label>
                批次類型
                <select
                  name="supersedesBatchId"
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSelectedCorrectionBatchId(nextId);
                    const source = workspace.batches.find(
                      (batch) => batch.id === nextId,
                    );
                    if (source) {
                      setSelectedCourseVersion(source.courseVersionId);
                    }
                  }}
                  value={selectedCorrectionBatchId}
                >
                  <option value="">首次送審</option>
                  {correctionSources.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      補正 {batch.courseLabel}／
                      {new Date(batch.createdAt).toLocaleDateString("zh-TW")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                課程版本
                <select
                  disabled={Boolean(selectedCorrectionBatch)}
                  name="courseVersionId"
                  onChange={(event) =>
                    setSelectedCourseVersion(event.target.value)
                  }
                  value={batchCourseForCreate?.courseVersionId ?? ""}
                >
                  {workspace.batchCourseOptions.map((option) => (
                    <option
                      key={option.courseVersionId}
                      value={option.courseVersionId}
                    >
                      {option.label}／{option.accreditationLabel}
                    </option>
                  ))}
                </select>
              </label>
              {!selectedCorrectionBatch &&
                batchCourseForCreate &&
                batchCourseForCreate.liveSessions.length > 0 && (
                  <label>
                    直播場次
                    <select
                      key={batchCourseForCreate.courseVersionId}
                      name="liveSessionId"
                      required
                      defaultValue={
                        batchCourseForCreate.liveSessions[0]?.id ?? ""
                      }
                    >
                      {batchCourseForCreate.liveSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              <label>
                主管機關範本版本
                <input
                  name="templateVersion"
                  minLength={1}
                  maxLength={100}
                  required
                />
              </label>
              <button className="button" disabled={busy} type="submit">
                建立資格預覽批次
              </button>
            </>
          )}
        </form>
      )}

      <section className="single-step-form">
        <h2>送審批次與結果</h2>
        {workspace.batches.length === 0 && (
          <p className="closed-note">目前尚無送審批次。</p>
        )}
        {workspace.batches.map((batch) => {
          const includedItems = batch.items.filter(
            (item) => item.status === "included",
          );
          return (
            <article className="context-action-form" key={batch.id}>
              <strong>{batch.courseLabel}</strong>
              <p>
                狀態：{batchStatusLabels[batch.status] ?? batch.status}
                ；範本：{batch.templateVersion}；建立：
                {new Date(batch.createdAt).toLocaleString("zh-TW")}
              </p>
              {batch.supersedesBatchId && (
                <p className="success-note">
                  此批次補正來源：{batch.supersedesBatchId}
                </p>
              )}
              {batch.isolatedAt && (
                <p className="closed-note">
                  已隔離（
                  {new Date(batch.isolatedAt).toLocaleString("zh-TW")}
                  ）：{batch.isolationReason}
                </p>
              )}
              <p>
                可送審 {includedItems.length} 人／不合格{" "}
                {
                  batch.items.filter((item) => item.status === "excluded")
                    .length
                }{" "}
                人
              </p>
              {batch.items.map((item) => (
                <p key={item.enrollmentId}>
                  {item.learnerLabel}：{item.status}
                  {item.missingReasons.length > 0
                    ? `（${item.missingReasons.join("、")}）`
                    : ""}
                </p>
              ))}

              {batch.canMarkSubmitted && (
                <form
                  className="context-action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    run(
                      async () =>
                        post(
                          `/api/staff/accreditation/batches/${batch.id}/submitted`,
                          {
                            externalReference: form.get("externalReference"),
                            reason: form.get("reason"),
                            stepUpNonce: await obtainStepUp(
                              "accreditation_result",
                              batch.id,
                            ),
                          },
                        ),
                      "批次已標記送交主管機關",
                    );
                  }}
                >
                  <label>
                    主管機關收件編號
                    <input
                      name="externalReference"
                      minLength={3}
                      maxLength={500}
                      required
                    />
                  </label>
                  <label>
                    送出理由／佐證
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy} type="submit">
                    Fresh TOTP 後標記已送出
                  </button>
                </form>
              )}

              {batch.canRecordResults && includedItems.length > 0 && (
                <form
                  className="context-action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const items = includedItems.map((item) => ({
                      enrollmentId: item.enrollmentId,
                      status: form.get(`status-${item.enrollmentId}`),
                      reason: form.get(`reason-${item.enrollmentId}`),
                    }));
                    run(
                      async () =>
                        post(
                          `/api/staff/accreditation/batches/${batch.id}/results`,
                          {
                            items,
                            reason: form.get("reason"),
                            stepUpNonce: await obtainStepUp(
                              "accreditation_result",
                              batch.id,
                            ),
                          },
                        ),
                      "主管機關結果已回填",
                    );
                  }}
                >
                  <h3>回填主管機關逐筆結果</h3>
                  {includedItems.map((item) => (
                    <fieldset className="break-editor" key={item.enrollmentId}>
                      <legend>{item.learnerLabel}</legend>
                      <label>
                        結果
                        <select
                          defaultValue="accepted"
                          name={`status-${item.enrollmentId}`}
                        >
                          <option value="accepted">認列</option>
                          <option value="needs_correction">待補正</option>
                          <option value="rejected">不認列</option>
                        </select>
                      </label>
                      <label>
                        逐筆依據
                        <input
                          name={`reason-${item.enrollmentId}`}
                          minLength={3}
                          maxLength={1000}
                          required
                        />
                      </label>
                    </fieldset>
                  ))}
                  <label>
                    本次整批回填理由
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy} type="submit">
                    Fresh TOTP 後保存結果
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </section>

      <p aria-live="polite" className="flow-message" role="status">
        {message}
      </p>
    </div>
  );
}
