"use client";

import { useState } from "react";
import type {
  ZoomOrphanCleanupItem,
  ZoomSetupReconciliationItem,
} from "@/application/workspace";
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

async function stepUp(action: SensitiveStaffAction, targetId: string) {
  return obtainStepUp(stepUpActionForStaffAction(action), targetId);
}

function statusLabel(item: ZoomSetupReconciliationItem) {
  switch (item.reviewStatus) {
    case "provider_request_in_flight":
      return `等待供應商結果；${new Date(item.claimEligibleAt).toLocaleString(
        "zh-TW",
      )} 後仍無收據才可人工查核`;
    case "proposal_required":
      return "等待提出復原方案";
    case "awaiting_review":
      return "等待第二位積分審核員覆核";
    case "rejected":
      return "前次方案已拒絕，可依新證據重新提案";
    case "provider_verification":
      return item.jobStatus === "leased"
        ? "正在向 Zoom 驗證既有會議"
        : "已核准，等待 Zoom 驗證工作";
    case "provider_verification_failed":
      return "Zoom 驗證工作已停止重試，需工程與營運查核";
    case "provider_verification_complete":
      return "Zoom 驗證已完成，等待場次完成登錄";
  }
}

function ReconciliationCase({ item }: { item: ZoomSetupReconciliationItem }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
            "案件未更新；請確認 fresh TOTP、第二人覆核與 Zoom 證據。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <article className="context-action-form">
      <h3>{item.title}</h3>
      <dl className="compact-data-list">
        <div>
          <dt>建會請求鎖定</dt>
          <dd>{new Date(item.claimedAt).toLocaleString("zh-TW")}</dd>
        </div>
        <div>
          <dt>目前狀態</dt>
          <dd>{statusLabel(item)}</dd>
        </div>
        {item.resolutionKind && (
          <div>
            <dt>提案</dt>
            <dd>
              {item.resolutionKind === "register_existing"
                ? `登錄既有 Zoom 會議 ${item.providerMeetingNumber ?? ""}`
                : "確認 Zoom 未建立會議後釋放重試"}
            </dd>
          </div>
        )}
        {item.proposalReason && (
          <div>
            <dt>提案理由</dt>
            <dd>{item.proposalReason}</dd>
          </div>
        )}
        {item.evidenceReference && (
          <div>
            <dt>外部證據</dt>
            <dd>{item.evidenceReference}</dd>
          </div>
        )}
      </dl>

      {item.canPropose && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const resolutionKind = String(form.get("resolutionKind"));
            run(
              async () =>
                post(
                  `/api/staff/live/${item.liveSessionId}/setup-reconciliation`,
                  {
                    resolutionKind,
                    providerMeetingNumber:
                      resolutionKind === "register_existing"
                        ? String(form.get("providerMeetingNumber") ?? "").trim()
                        : null,
                    reason: form.get("reason"),
                    evidenceReference: form.get("evidenceReference"),
                    stepUpNonce: await stepUp(
                      "zoom_setup_reconcile_propose",
                      item.liveSessionId,
                    ),
                  },
                ),
              "復原方案已送出，正等待另一位積分審核員覆核。",
            );
          }}
        >
          <label>
            復原方案
            <select name="resolutionKind" defaultValue="" required>
              <option value="" disabled>
                請依 Zoom 管理後台查核結果選擇
              </option>
              <option value="register_existing">
                Zoom 已建立：登錄既有會議
              </option>
              <option value="confirm_not_created">
                Zoom 確認未建立：釋放重新建立
              </option>
            </select>
          </label>
          <label>
            Zoom 會議號碼（只有「已建立」時填寫）
            <input
              inputMode="numeric"
              maxLength={12}
              minLength={9}
              name="providerMeetingNumber"
              pattern="[0-9]{9,12}"
            />
          </label>
          <label>
            查核理由
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <label>
            Zoom 管理後台證據編號或內部案件編號
            <input
              name="evidenceReference"
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            Fresh TOTP 後送出復原方案
          </button>
        </form>
      )}

      {item.canDecide && item.requestId && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(
              async () =>
                post(
                  `/api/staff/live/setup-reconciliations/${item.requestId}/decision`,
                  {
                    decision: form.get("decision"),
                    reason: form.get("reason"),
                    stepUpNonce: await stepUp(
                      "zoom_setup_reconcile_decide",
                      item.requestId!,
                    ),
                  },
                ),
              "覆核決定已保存；系統會依決定安全復原，不會重複建會。",
            );
          }}
        >
          <label>
            第二人覆核
            <select name="decision" defaultValue="" required>
              <option value="" disabled>
                請選擇
              </option>
              <option value="approve">證據相符，核准</option>
              <option value="reject">證據不足，拒絕</option>
            </select>
          </label>
          <label>
            覆核理由
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button" disabled={busy} type="submit">
            Fresh TOTP 後保存覆核
          </button>
        </form>
      )}

      {!item.canPropose && !item.canDecide && (
        <p className="closed-note">
          你目前只能查看狀態；系統會保留已核准工作的進度，且提案者不能核准自己的方案。
        </p>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function ZoomSetupReconciliationPanel({
  items,
}: {
  items: ZoomSetupReconciliationItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="organization-tools">
      <div className="warning-panel">
        <strong>Zoom 建會結果需要人工查核</strong>
        <p>
          系統已停止自動重試，避免建立兩場會議。課程管理員提出方案後，必須由另一位積分審核員覆核。
        </p>
      </div>
      {items.map((item) => (
        <ReconciliationCase item={item} key={item.liveSessionId} />
      ))}
    </section>
  );
}

export function ZoomOrphanCleanupPanel({
  items,
}: {
  items: ZoomOrphanCleanupItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="organization-tools">
      <div className="warning-panel">
        <strong>Zoom 重複會議正在清理</strong>
        <p>
          系統只會刪除沒有權威收據的會議；204／404
          確認後才結案。失敗會自動重試並保留稽核紀錄。
        </p>
      </div>
      {items.map((item) => (
        <article className="context-action-form" key={item.jobId}>
          <h3>{item.title}</h3>
          <dl className="compact-data-list">
            <div>
              <dt>Zoom 會議號碼</dt>
              <dd>{item.providerMeetingNumber}</dd>
            </div>
            <div>
              <dt>工作狀態</dt>
              <dd>
                {item.status === "dead_letter"
                  ? "重試已停止，需工程查核"
                  : item.status === "leased"
                    ? "正在確認刪除"
                    : item.status === "retry"
                      ? "刪除失敗，等待重試"
                      : "等待自動清理"}
              </dd>
            </div>
            <div>
              <dt>嘗試次數</dt>
              <dd>{item.attemptCount}</dd>
            </div>
            {item.lastError && (
              <div>
                <dt>最近錯誤</dt>
                <dd>{presentErrorCode(item.lastError, "Zoom 刪除失敗")}</dd>
              </div>
            )}
          </dl>
        </article>
      ))}
    </section>
  );
}
