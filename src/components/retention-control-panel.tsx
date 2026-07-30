"use client";

import { useState } from "react";
import type { RetentionControlPlane } from "@/application/operations-v2";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "RETENTION_DRY_RUN_REJECTED");
  }
  return result?.data;
}

function RetentionPolicy({
  policy,
}: {
  policy: RetentionControlPlane["policies"][number];
}) {
  const [reason, setReason] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceEventId, setEvidenceEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = policy.latestRequest?.status === "pending";

  async function requestDryRun() {
    setBusy(true);
    setMessage("等待 fresh TOTP 驗證…");
    try {
      const stepUpNonce = await obtainStepUp(
        "retention_dry_run",
        `${policy.policyRevisionId}:dry_run`,
      );
      await postJson(
        `/api/staff/operations/retention/${policy.policyRevisionId}`,
        { reason, stepUpNonce },
      );
      setMessage("候選資料只完成 dry-run，尚未也不會在此刪除。");
      window.location.reload();
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "REQUEST_REJECTED",
          "Dry-run 未建立；請確認政策支援、權限、理由與 fresh TOTP。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!policy.latestRequest) return;
    setBusy(true);
    setMessage("先建立不可覆寫證據，再進行獨立覆核…");
    try {
      let retainedEvidenceEventId = evidenceEventId;
      if (!retainedEvidenceEventId) {
        const evidenceNonce = await obtainStepUp(
          "operations_evidence",
          `retention_candidate_manifest_verified:${policy.latestRequest.requestId}`,
        );
        const evidence = await postJson(
          `/api/staff/operations/retention/requests/${policy.latestRequest.requestId}/evidence`,
          {
            reason,
            evidenceReference,
            stepUpNonce: evidenceNonce,
          },
        );
        retainedEvidenceEventId = String(evidence?.evidenceEventId ?? "");
        if (!retainedEvidenceEventId) {
          throw new Error("RETENTION_EVIDENCE_REJECTED");
        }
        setEvidenceEventId(retainedEvidenceEventId);
      }
      const stepUpNonce = await obtainStepUp(
        "retention_dry_run",
        `${policy.latestRequest.requestId}:${decision}`,
      );
      await postJson(
        `/api/staff/operations/retention/requests/${policy.latestRequest.requestId}/decision`,
        {
          decision,
          reason,
          evidenceEventId: retainedEvidenceEventId,
          stepUpNonce,
        },
      );
      setMessage("覆核證據已記錄；沒有執行任何實體清除。");
      window.location.reload();
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "REQUEST_REJECTED",
          "覆核未完成；需由另一位平台管理員建立綁定此候選摘要的不可覆寫證據。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="context-action-form">
      <div className="section-heading">
        <div>
          <p className="eyebrow">第 {policy.revision} 版</p>
          <h3>{policy.dataClass}</h3>
        </div>
        <span>{policy.dryRunSupported ? "可 dry-run" : "未支援"}</span>
      </div>
      <p>
        線上 {policy.onlineDays} 天／封存 {policy.archiveDays} 天；生效於{" "}
        {new Date(policy.effectiveAt).toLocaleString("zh-TW")}
      </p>
      {policy.latestRequest && (
        <dl className="compact-data-list">
          <div>
            <dt>最近候選數</dt>
            <dd>{policy.latestRequest.candidateCount}</dd>
          </div>
          <div>
            <dt>候選摘要</dt>
            <dd>
              <code>{policy.latestRequest.candidateDigest}</code>
            </dd>
          </div>
          <div>
            <dt>覆核狀態</dt>
            <dd>{policy.latestRequest.status}</dd>
          </div>
        </dl>
      )}
      {pending && policy.latestRequest?.canReview ? (
        <>
          <label>
            覆核理由
            <textarea
              maxLength={1000}
              minLength={10}
              onChange={(event) => {
                setReason(event.target.value);
                setEvidenceEventId("");
              }}
              value={reason}
            />
          </label>
          <label>
            外部證據參照
            <input
              maxLength={500}
              minLength={3}
              onChange={(event) => {
                setEvidenceReference(event.target.value);
                setEvidenceEventId("");
              }}
              value={evidenceReference}
            />
          </label>
          <div className="page-actions">
            <button
              className="button"
              disabled={
                busy ||
                reason.trim().length < 10 ||
                evidenceReference.trim().length < 3
              }
              onClick={() => void decide("approve")}
              type="button"
            >
              Fresh TOTP 後批准證據
            </button>
            <button
              className="button secondary"
              disabled={
                busy ||
                reason.trim().length < 10 ||
                evidenceReference.trim().length < 3
              }
              onClick={() => void decide("reject")}
              type="button"
            >
              駁回
            </button>
          </div>
        </>
      ) : pending ? (
        <p className="closed-note">
          需由另一位平台管理員核對候選摘要與外部證據。
        </p>
      ) : policy.dryRunSupported ? (
        <>
          <label>
            Dry-run 理由
            <textarea
              maxLength={1000}
              minLength={10}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || reason.trim().length < 10}
            onClick={() => void requestDryRun()}
            type="button"
          >
            Fresh TOTP 後計算候選資料
          </button>
        </>
      ) : (
        <p className="closed-note">
          此資料類別尚未建立安全候選查詢，不允許用動態 SQL 或人工刪除取代。
        </p>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function RetentionControlPanel({
  workspace,
}: {
  workspace: RetentionControlPlane;
}) {
  return (
    <section className="workspace-section" aria-labelledby="retention-control">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Dry-run only</p>
          <h2 id="retention-control">保存政策候選與雙人證據</h2>
        </div>
        <span>{workspace.policies.length} 個有效政策</span>
      </div>
      <p className="closed-note">{workspace.notice}</p>
      <div className="record-grid">
        {workspace.policies.map((policy) => (
          <RetentionPolicy key={policy.policyRevisionId} policy={policy} />
        ))}
      </div>
    </section>
  );
}
