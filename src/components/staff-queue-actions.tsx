"use client";

import Link from "next/link";
import { useState } from "react";
import type { StaffQueueItem } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";
import {
  stepUpActionForStaffAction,
  type SensitiveStaffAction,
} from "@/domain/staff-actions";
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

function textPayload(
  payload: StaffQueueItem["actions"][number]["payload"],
  key: string,
) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function numberPayload(
  payload: StaffQueueItem["actions"][number]["payload"],
  key: string,
) {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

const staffRoleLabels: Record<string, string> = {
  instructor: "講師",
  course_admin: "課程管理員",
  accreditation_reviewer: "積分審核員",
  finance: "財務",
  support: "客服",
  platform_admin: "平台管理員",
};

async function sensitiveNonce(action: SensitiveStaffAction, targetId: string) {
  return obtainStepUp(stepUpActionForStaffAction(action), targetId);
}

async function generateAndDownloadExport(batchId: string) {
  const authorization = await post("/api/staff/accreditation/exports", {
    batchId,
    target: batchId,
    stepUpNonce: await sensitiveNonce("export_generate_download", batchId),
  });
  const capability =
    authorization &&
    typeof authorization === "object" &&
    "capability" in authorization &&
    typeof authorization.capability === "string"
      ? authorization.capability
      : "";
  if (!capability) throw new Error("EXPORT_CAPABILITY_INVALID");

  const response = await fetch("/api/staff/accreditation/exports/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: capability }),
  });
  if (!response.ok) throw new Error("EXPORT_DOWNLOAD_REJECTED");
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    disposition.match(/filename="([^"]+)"/)?.[1] ?? "suiyue-accreditation.xlsx";
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

const identityLabels: Record<string, string> = {
  realName: "姓名",
  nationalId: "身分證／居留證",
  birthDate: "出生日期",
  careWorkerId: "長照人員認證字號",
  personnelCategory: "人員類別",
  phone: "手機",
  serviceUnit: "服務單位",
};

function IdentityReviewAction({
  action,
}: {
  action: StaffQueueItem["actions"][number];
}) {
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(
    null,
  );
  const [message, setMessage] = useState(
    "必須先完成必要性說明、雙人授權與 fresh TOTP，才能短暫查看本案明文。",
  );
  const [busy, setBusy] = useState(false);

  return (
    <div className="context-action-form">
      <strong>{action.label}</strong>
      {!identity ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            void sensitiveNonce("identity_decide", action.targetId)
              .then((nonce) =>
                post(`/api/staff/identity/${action.targetId}/access`, {
                  reason: form.get("reason"),
                  stepUpNonce: nonce,
                }),
              )
              .then((result) => {
                if (!result?.ready || !result.identity) {
                  setMessage(
                    result?.assignedReviewerMustReauthorize
                      ? "雙人授權已齊全；承辦審核者請再完成一次 fresh TOTP 取得兩分鐘明文。"
                      : `已記錄 ${Number(result?.approvalCount ?? 1)} 位審核者；等待另一位不同審核者。`,
                  );
                  return;
                }
                setIdentity(result.identity as Record<string, unknown>);
                setMessage(
                  "必要明文只保存在目前頁面記憶體；確認後再於下方作成決定。",
                );
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "明文查閱未授權；不得只看遮罩資料就核准。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            查閱必要性
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {busy ? "驗證中…" : "Fresh TOTP 後查看必要明文"}
          </button>
        </form>
      ) : (
        <>
          <dl className="compact-data-list">
            {Object.entries(identity)
              .filter(([key]) => key !== "schemaVersion")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{identityLabels[key] ?? key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              void sensitiveNonce("identity_decide", action.targetId)
                .then((nonce) =>
                  post(`/api/staff/identity/${action.targetId}/decision`, {
                    decision: form.get("decision"),
                    reason: form.get("reason"),
                    stepUpNonce: nonce,
                  }),
                )
                .then(() => {
                  setIdentity(null);
                  window.location.reload();
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "決定未保存；請確認雙人授權與案件狀態。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label>
              決定
              <select name="decision" required defaultValue="">
                <option value="" disabled>
                  請選擇
                </option>
                <option value="approve">核准</option>
                <option value="needs_correction">要求補正</option>
                <option value="reject">拒絕</option>
              </select>
            </label>
            <label>
              決定理由
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "處理中…" : "Fresh TOTP 後保存決定"}
            </button>
          </form>
        </>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}

function RefundDisbursementAction({
  action,
}: {
  action: StaffQueueItem["actions"][number];
}) {
  const [account, setAccount] = useState<{
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);
  const [message, setMessage] = useState(
    "退款已由兩位人員核准後，才可用 fresh TOTP 短暫查看匯款帳戶。",
  );
  const [busy, setBusy] = useState(false);

  return (
    <div className="context-action-form">
      <strong>{action.label}</strong>
      {!account ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            void obtainStepUp("refund_account", action.targetId)
              .then((nonce) =>
                post(`/api/staff/refunds/${action.targetId}/account`, {
                  reason: form.get("reason"),
                  stepUpNonce: nonce,
                }),
              )
              .then((result) => {
                if (
                  !result ||
                  typeof result !== "object" ||
                  typeof result.bankName !== "string" ||
                  typeof result.bankCode !== "string" ||
                  typeof result.accountNumber !== "string" ||
                  typeof result.accountName !== "string"
                ) {
                  throw new Error("REFUND_ACCOUNT_ACCESS_REJECTED");
                }
                setAccount(result);
                setMessage(
                  "帳戶明文只保存在目前頁面記憶體。完成匯款登錄後仍須由另一位財務人員確認。",
                );
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "帳戶未解鎖；退款可能尚未完成雙人核准。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            查閱帳戶必要性
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {busy ? "驗證中…" : "Fresh TOTP 後查看匯款帳戶"}
          </button>
        </form>
      ) : (
        <>
          <dl className="compact-data-list">
            <div>
              <dt>銀行</dt>
              <dd>
                {account.bankName}（{account.bankCode}）
              </dd>
            </div>
            <div>
              <dt>戶名</dt>
              <dd>{account.accountName}</dd>
            </div>
            <div>
              <dt>帳號</dt>
              <dd>{account.accountNumber}</dd>
            </div>
          </dl>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              void sensitiveNonce("refund_disburse", action.targetId)
                .then((nonce) =>
                  post("/api/staff/refunds/disbursements", {
                    refundCaseId: action.targetId,
                    allocationId: textPayload(action.payload, "allocationId"),
                    amountTwd: Number(form.get("amountTwd")),
                    externalReference: form.get("externalReference"),
                    stepUpNonce: nonce,
                  }),
                )
                .then(() => {
                  setAccount(null);
                  window.location.reload();
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "匯款登錄未保存；請檢查配置餘額與交易序號。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <p>
              退款項目：
              {textPayload(action.payload, "allocationLabel") ||
                "本案已核准配置"}
            </p>
            <label>
              實際匯回金額（NT$）
              <input
                name="amountTwd"
                type="number"
                min={1}
                max={numberPayload(action.payload, "maxAmountTwd") || undefined}
                required
              />
            </label>
            <label>
              銀行交易序號
              <input
                name="externalReference"
                minLength={3}
                maxLength={200}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "處理中…" : "登錄匯款並交第二人確認"}
            </button>
          </form>
        </>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}

function PointRefundResultAction({
  action,
}: {
  action: StaffQueueItem["actions"][number];
}) {
  const [account, setAccount] = useState<{
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);
  const [message, setMessage] = useState(
    "點數退款完成兩位財務核准後，才能短暫解鎖匯款帳戶。",
  );
  const [busy, setBusy] = useState(false);

  return (
    <div className="context-action-form">
      <strong>{action.label}</strong>
      <p>
        {textPayload(action.payload, "organizationLabel")}／
        {numberPayload(action.payload, "points").toLocaleString("zh-TW")}
        點／NT${" "}
        {numberPayload(action.payload, "amountTwd").toLocaleString("zh-TW")}
      </p>
      {!account ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            void obtainStepUp("point_refund_account", action.targetId)
              .then((nonce) =>
                post(
                  `/api/staff/organizations/point-refunds/${action.targetId}/account`,
                  {
                    reason: form.get("reason"),
                    stepUpNonce: nonce,
                  },
                ),
              )
              .then((result) => {
                if (
                  !result ||
                  typeof result !== "object" ||
                  typeof result.bankName !== "string" ||
                  typeof result.bankCode !== "string" ||
                  typeof result.accountNumber !== "string" ||
                  typeof result.accountName !== "string"
                ) {
                  throw new Error("POINT_REFUND_ACCOUNT_ACCESS_REJECTED");
                }
                setAccount(result);
                setMessage("帳戶明文只保存在目前頁面記憶體。");
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "帳戶未解鎖；案件可能尚未完成雙人核准。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            查閱帳戶必要性
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {busy ? "驗證中…" : "Fresh TOTP 後查看匯款帳戶"}
          </button>
        </form>
      ) : (
        <>
          <dl className="compact-data-list">
            <div>
              <dt>銀行</dt>
              <dd>
                {account.bankName}（{account.bankCode}）
              </dd>
            </div>
            <div>
              <dt>戶名</dt>
              <dd>{account.accountName}</dd>
            </div>
            <div>
              <dt>帳號</dt>
              <dd>{account.accountNumber}</dd>
            </div>
          </dl>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const succeeded = form.get("succeeded") === "true";
              setBusy(true);
              void sensitiveNonce("point_refund_result", action.targetId)
                .then((nonce) =>
                  post(
                    `/api/staff/organizations/point-refunds/${action.targetId}/result`,
                    {
                      succeeded,
                      externalReference:
                        String(form.get("externalReference") ?? "").trim() ||
                        null,
                      failureReason:
                        String(form.get("failureReason") ?? "").trim() || null,
                      reason: form.get("reason"),
                      stepUpNonce: nonce,
                    },
                  ),
                )
                .then(() => {
                  setAccount(null);
                  window.location.reload();
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "點數退款結果未保存；請檢查交易序號與案件狀態。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label>
              匯款結果
              <select name="succeeded" defaultValue="true" required>
                <option value="true">匯款成功</option>
                <option value="false">匯款失敗</option>
              </select>
            </label>
            <label>
              成功時的銀行交易序號
              <input name="externalReference" maxLength={200} />
            </label>
            <label>
              失敗時的原因
              <textarea name="failureReason" maxLength={1000} />
            </label>
            <label>
              作業理由
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "處理中…" : "Fresh TOTP 後保存退款結果"}
            </button>
          </form>
        </>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}

function ProviderAnomalyProposalAction({
  action,
}: {
  action: StaffQueueItem["actions"][number];
}) {
  const [resolutionKind, setResolutionKind] = useState("");
  const [message, setMessage] = useState(
    "請先在 Zoom 管理後台核對原始參與者紀錄；系統不接受直接覆寫出席秒數。",
  );
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="context-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const synthetic = resolutionKind === "synthesize_left";
        setBusy(true);
        setMessage("驗證中…");
        void sensitiveNonce("provider_anomaly_propose", action.targetId)
          .then((nonce) =>
            post(
              `/api/staff/live/provider-anomalies/${action.targetId}/proposal`,
              {
                resolutionKind,
                participantUuid: synthetic
                  ? String(form.get("participantUuid") ?? "").trim()
                  : null,
                assumedLeftAt: synthetic
                  ? new Date(String(form.get("assumedLeftAt"))).toISOString()
                  : null,
                reason: form.get("reason"),
                evidenceReference: form.get("evidenceReference"),
                stepUpNonce: nonce,
              },
            ),
          )
          .then(() => {
            setMessage("補正方案已送出，等待另一位積分審核員覆核。");
            window.location.reload();
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "方案未送出；請確認原始 Zoom 證據、fresh TOTP 與案件狀態。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <strong>{action.label}</strong>
      <label>
        處理方式
        <select
          name="resolutionKind"
          value={resolutionKind}
          onChange={(event) => setResolutionKind(event.target.value)}
          required
        >
          <option value="" disabled>
            請選擇
          </option>
          <option value="accept_provider_evidence">
            接受晚到的 Zoom 原始事件並重新結算
          </option>
          <option value="synthesize_left">
            依 Zoom 報表補一筆缺失的離場事件
          </option>
          <option value="disqualify_booking">
            證據無法修復，維持本次直播不合格
          </option>
        </select>
      </label>
      {resolutionKind === "synthesize_left" && (
        <>
          <label>
            Zoom participant UUID
            <input name="participantUuid" maxLength={500} required />
          </label>
          <label>
            Zoom 報表中的離場時間
            <input name="assumedLeftAt" type="datetime-local" required />
          </label>
        </>
      )}
      <label>
        Zoom 報表、Webhook 或內部案件證據編號
        <input
          name="evidenceReference"
          minLength={3}
          maxLength={500}
          required
        />
      </label>
      <label>
        判斷理由
        <textarea name="reason" minLength={10} maxLength={1000} required />
      </label>
      <button className="button" disabled={busy} type="submit">
        {busy ? "處理中…" : "Fresh TOTP 後送出方案"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}

export function StaffQueueActions({ item }: { item: StaffQueueItem }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function execute(
    action: StaffQueueItem["actions"][number],
    form: FormData,
  ) {
    const reason = String(form.get("reason") ?? "").trim();
    const decision = String(form.get("decision") ?? "");
    let path = "";
    let body: Record<string, unknown> = { reason };
    switch (action.key) {
      case "finance_allocate":
        path = "/api/staff/finance/allocate";
        body = {
          targetType: textPayload(action.payload, "targetType"),
          bankTransactionId: textPayload(action.payload, "bankTransactionId"),
          targetId: action.targetId,
          amountTwd: numberPayload(action.payload, "amountTwd"),
          reason,
        };
        break;
      case "finance_confirm":
        path = "/api/staff/finance/confirm";
        body = {
          targetType: textPayload(action.payload, "targetType"),
          allocationId: action.targetId,
          reason,
        };
        break;
      case "organization_review":
        path = `/api/staff/organizations/${action.targetId}/review`;
        body = { decision, reason };
        break;
      case "course_publish":
        path = `/api/staff/courses/${action.targetId}/publish`;
        body = {
          reason,
          stepUpNonce: await sensitiveNonce("course_publish", action.targetId),
        };
        break;
      case "identity_decide":
        path = `/api/staff/identity/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce("identity_decide", action.targetId),
        };
        break;
      case "refund_decide":
        path = `/api/staff/refunds/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce("refund_decide", action.targetId),
        };
        break;
      case "attendance_decide":
        path = `/api/staff/attendance/corrections/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce(
            "attendance_decide",
            action.targetId,
          ),
        };
        break;
      case "prerequisite_decide":
        path = `/api/staff/setup/${action.targetId}/decision`;
        body = {
          kind: textPayload(action.payload, "kind"),
          decision,
          reason,
          stepUpNonce: await sensitiveNonce(
            "prerequisite_decide",
            action.targetId,
          ),
        };
        break;
      case "bank_reconcile":
        path = `/api/staff/finance/bank-imports/${action.targetId}/reconcile`;
        body = {
          reason,
          stepUpNonce: await sensitiveNonce("bank_reconcile", action.targetId),
        };
        break;
      case "invoice_result": {
        const amount = String(form.get("amountTwd") ?? "").trim();
        path = `/api/staff/finance/invoices/${action.targetId}/result`;
        body = {
          eventType: form.get("eventType"),
          amountTwd: amount ? Number(amount) : null,
          externalReference: form.get("externalReference"),
          reason,
          stepUpNonce: await sensitiveNonce("invoice_result", action.targetId),
        };
        break;
      }
      case "refund_disburse":
        path = "/api/staff/refunds/disbursements";
        body = {
          refundCaseId: action.targetId,
          allocationId: textPayload(action.payload, "allocationId"),
          amountTwd: Number(form.get("amountTwd")),
          externalReference: form.get("externalReference"),
          stepUpNonce: await sensitiveNonce("refund_disburse", action.targetId),
        };
        break;
      case "refund_disbursement_confirm": {
        const refundCaseId = textPayload(action.payload, "refundCaseId");
        path = `/api/staff/refunds/disbursements/${action.targetId}/confirm`;
        body = {
          refundCaseId,
          reason,
          stepUpNonce: await sensitiveNonce(
            "refund_disbursement_confirm",
            refundCaseId,
          ),
        };
        break;
      }
      case "role_change_request": {
        const role = String(form.get("role") ?? "");
        const change = String(form.get("roleAction") ?? "");
        path = "/api/staff/roles/requests";
        body = {
          subjectPersonId: action.targetId,
          role,
          action: change,
          reason,
          stepUpNonce: await sensitiveNonce(
            "role_change_request",
            `${action.targetId}:${role}:${change}`,
          ),
        };
        break;
      }
      case "role_change_decide":
        path = `/api/staff/roles/requests/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce(
            "role_change_decide",
            action.targetId,
          ),
        };
        break;
      case "point_refund_decide":
        path = `/api/staff/organizations/point-refunds/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce(
            "point_refund_decide",
            action.targetId,
          ),
        };
        break;
      case "provider_anomaly_decide":
        path = `/api/staff/live/provider-anomalies/resolutions/${action.targetId}/decision`;
        body = {
          decision,
          reason,
          stepUpNonce: await sensitiveNonce(
            "provider_anomaly_decide",
            action.targetId,
          ),
        };
        break;
      default:
        throw new Error("ACTION_NOT_SUPPORTED");
    }
    await post(path, body);
  }

  if (item.actions.length === 0) {
    return <p className="closed-note">此案件目前沒有你可執行的操作。</p>;
  }

  return (
    <div className="staff-context-actions">
      <h3>可執行操作</h3>
      {item.actions.map((action) => {
        if (action.key === "identity_decide") {
          return (
            <IdentityReviewAction
              action={action}
              key={`${action.key}:${action.targetId}`}
            />
          );
        }
        if (action.key === "refund_disburse") {
          return (
            <RefundDisbursementAction
              action={action}
              key={`${action.key}:${action.targetId}`}
            />
          );
        }
        if (action.key === "point_refund_result") {
          return (
            <PointRefundResultAction
              action={action}
              key={`${action.key}:${action.targetId}`}
            />
          );
        }
        if (action.key === "provider_anomaly_propose") {
          return (
            <ProviderAnomalyProposalAction
              action={action}
              key={`${action.key}:${action.targetId}`}
            />
          );
        }
        if (action.key === "live_open") {
          return (
            <Link
              className="button secondary"
              href={`/staff/live/${action.targetId}`}
              key={`${action.key}:${action.targetId}`}
            >
              {action.label}
            </Link>
          );
        }
        if (action.key === "export_generate_download") {
          return (
            <button
              className="button secondary"
              disabled={busy}
              key={`${action.key}:${action.targetId}`}
              onClick={() => {
                setBusy(true);
                setMessage("");
                void generateAndDownloadExport(action.targetId)
                  .then(() =>
                    setMessage(
                      "送審檔已產生並下載；一次性下載權限已立即失效。",
                    ),
                  )
                  .catch((error: Error) =>
                    setMessage(
                      presentErrorCode(
                        error.message,
                        "匯出未完成；請確認覆核、雙重驗證與案件狀態。",
                      ),
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
              type="button"
            >
              {busy ? "處理中…" : action.label}
            </button>
          );
        }
        const decisionOptions = [
          "organization_review",
          "refund_decide",
          "attendance_decide",
          "prerequisite_decide",
          "role_change_decide",
          "point_refund_decide",
          "provider_anomaly_decide",
        ].includes(action.key)
          ? [
              ["approve", "核准"],
              ["reject", "拒絕"],
            ]
          : [];
        return (
          <form
            className="context-action-form"
            key={`${action.key}:${action.targetId}`}
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setMessage("");
              void execute(action, new FormData(event.currentTarget))
                .then(() => {
                  setMessage("操作已保存；重新整理後可查看最新狀態。");
                  window.location.reload();
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "操作未完成；權限、雙人覆核或案件狀態不符合。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <strong>{action.label}</strong>
            {decisionOptions.length > 0 && (
              <label>
                決定
                <select name="decision" required defaultValue="">
                  <option value="" disabled>
                    請選擇
                  </option>
                  {decisionOptions.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {action.key === "invoice_result" && (
              <>
                <label>
                  處理結果
                  <select name="eventType" required defaultValue="">
                    <option value="" disabled>
                      請選擇
                    </option>
                    <option value="issued">已開立</option>
                    <option value="failed">開立失敗</option>
                    <option value="allowance_completed">折讓完成</option>
                    <option value="void_completed">作廢完成</option>
                  </select>
                </label>
                <label>
                  本次金額（失敗事件可留空；不得高於案件顯示金額）
                  <input
                    name="amountTwd"
                    type="number"
                    min={1}
                    max={
                      numberPayload(action.payload, "maxAmountTwd") ||
                      numberPayload(action.payload, "amountTwd") ||
                      undefined
                    }
                  />
                </label>
                <label>
                  發票號碼／外部處理編號
                  <input name="externalReference" maxLength={500} />
                </label>
              </>
            )}
            {action.key === "role_change_request" && (
              <>
                <p>
                  異動對象：
                  {textPayload(action.payload, "subjectLabel") ||
                    item.referenceLabel}
                </p>
                <label>
                  角色
                  <select name="role" required defaultValue="">
                    <option value="" disabled>
                      請選擇
                    </option>
                    {Object.entries(staffRoleLabels)
                      .filter(([value]) => {
                        const allowed = textPayload(
                          action.payload,
                          "availableRoles",
                        )
                          .split(",")
                          .map((role) => role.trim())
                          .filter(Boolean);
                        return allowed.length === 0 || allowed.includes(value);
                      })
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  異動
                  <select name="roleAction" required defaultValue="">
                    <option value="" disabled>
                      請選擇
                    </option>
                    <option value="grant">授予</option>
                    <option value="revoke">撤銷</option>
                  </select>
                </label>
              </>
            )}
            <label>
              操作理由
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "處理中…" : action.label}
            </button>
          </form>
        );
      })}
      <p aria-live="polite">{message}</p>
    </div>
  );
}
