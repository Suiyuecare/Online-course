"use client";

import { useState } from "react";
import type {
  OperationsControlPlane,
  OperationsIncidentAction,
} from "@/application/operations-control-plane";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

const incidentActionLabels: Record<OperationsIncidentAction, string> = {
  contain: "確認已圍堵",
  investigate: "進入調查",
  record_legal_contact: "記錄法務聯繫",
  resolve: "標記已解決",
  close: "正式結案",
  reopen: "重新調查",
};

function incidentActions(
  incident: OperationsControlPlane["incidents"][number],
): OperationsIncidentAction[] {
  if (incident.status === "open") return ["contain"];
  if (incident.status === "contained") {
    return [
      ...(incident.legalContactedAt ? [] : (["record_legal_contact"] as const)),
      "investigate",
    ];
  }
  if (incident.status === "investigating") {
    return [
      ...(incident.legalContactedAt ? [] : (["record_legal_contact"] as const)),
      "resolve",
    ];
  }
  if (incident.status === "resolved") {
    return [
      ...(incident.legalContactedAt ? [] : (["record_legal_contact"] as const)),
      "reopen",
      "close",
    ];
  }
  return [];
}

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
    throw new Error(result?.error ?? "OPERATIONS_ACTION_REJECTED");
  }
  return result?.data;
}

function IncidentCase({
  incident,
}: {
  incident: OperationsControlPlane["incidents"][number];
}) {
  const availableActions = incidentActions(incident);
  const [action, setAction] = useState<OperationsIncidentAction>(
    availableActions[0] ?? "investigate",
  );
  const [reason, setReason] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function propose() {
    setBusy(true);
    setMessage("等待 fresh TOTP 驗證…");
    try {
      const stepUpNonce = await obtainStepUp(
        "incident_transition",
        `${incident.id}:${action}`,
      );
      await postJson(`/api/staff/operations/incidents/${incident.id}`, {
        operation: "propose",
        action,
        reason,
        evidenceReference: evidenceReference || null,
        stepUpNonce,
      });
      setMessage("已提出狀態變更，需另一位平台管理員覆核。");
      window.location.reload();
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "REQUEST_REJECTED",
          "事故狀態沒有變更；請確認權限、fresh TOTP、理由與目前狀態。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!incident.pendingRequest) return;
    setBusy(true);
    setMessage("等待獨立覆核的 fresh TOTP 驗證…");
    try {
      const stepUpNonce = await obtainStepUp(
        "incident_transition",
        `${incident.pendingRequest.id}:${decision}`,
      );
      await postJson(`/api/staff/operations/incidents/${incident.id}`, {
        operation: "decide",
        transitionRequestId: incident.pendingRequest.id,
        decision,
        reason,
        stepUpNonce,
      });
      setMessage(decision === "approve" ? "已批准並套用。" : "已駁回。");
      window.location.reload();
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "REQUEST_REJECTED",
          "覆核未完成；提出人不可覆核自己的申請。",
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
          <p className="eyebrow">
            {incident.severity.toUpperCase()} · {incident.status}
          </p>
          <h3>事故 {incident.id.slice(0, 8)}</h3>
        </div>
        <span className={`status ${incident.deadlineState}`}>
          {incident.deadlineState === "overdue"
            ? "通報逾期"
            : incident.deadlineState === "due_soon"
              ? "即將到期"
              : incident.deadlineState === "recorded"
                ? "法務已記錄"
                : "處理中"}
        </span>
      </div>
      <dl className="compact-data-list">
        <div>
          <dt>偵測時間</dt>
          <dd>{new Date(incident.detectedAt).toLocaleString("zh-TW")}</dd>
        </div>
        <div>
          <dt>通報期限</dt>
          <dd>
            {incident.notificationDeadlineAt
              ? new Date(incident.notificationDeadlineAt).toLocaleString(
                  "zh-TW",
                )
              : "未設定"}
          </dd>
        </div>
      </dl>
      {incident.pendingRequest ? (
        <>
          <p>
            待覆核：{incidentActionLabels[incident.pendingRequest.action]}（
            {new Date(incident.pendingRequest.requestedAt).toLocaleString(
              "zh-TW",
            )}
            ）
          </p>
          <label>
            覆核理由
            <textarea
              minLength={10}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </label>
          {incident.pendingRequest.canReview ? (
            <div className="page-actions">
              <button
                className="button"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void decide("approve")}
                type="button"
              >
                Fresh TOTP 後批准
              </button>
              <button
                className="button secondary"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void decide("reject")}
                type="button"
              >
                駁回申請
              </button>
            </div>
          ) : (
            <p className="closed-note">
              這是你提出的申請，必須由另一位平台管理員覆核。
            </p>
          )}
        </>
      ) : availableActions.length > 0 ? (
        <>
          <label>
            下一步
            <select
              onChange={(event) =>
                setAction(event.target.value as OperationsIncidentAction)
              }
              value={action}
            >
              {availableActions.map((item) => (
                <option key={item} value={item}>
                  {incidentActionLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            原因與判斷依據
            <textarea
              minLength={10}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </label>
          <label>
            證據參照（選填，不貼個資或密鑰）
            <input
              maxLength={500}
              onChange={(event) => setEvidenceReference(event.target.value)}
              value={evidenceReference}
            />
          </label>
          <button
            className="button"
            disabled={busy || reason.trim().length < 10}
            onClick={() => void propose()}
            type="button"
          >
            Fresh TOTP 後提出覆核
          </button>
        </>
      ) : (
        <p className="closed-note">事故已結案，原始事件與稽核鏈永久保留。</p>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

function DeadLetterCase({
  item,
}: {
  item: OperationsControlPlane["deadLetters"][number];
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: "retry" | "acknowledge") {
    setBusy(true);
    setMessage("等待 fresh TOTP 驗證…");
    try {
      const target = `${item.sourceKind}:${item.sourceId}:${action}`;
      const stepUpNonce = await obtainStepUp("operations_dead_letter", target);
      await postJson(
        `/api/staff/operations/dead-letters/${item.sourceKind}/${item.sourceId}`,
        { action, reason, stepUpNonce },
      );
      setMessage(action === "retry" ? "已排入安全重算。" : "已留下處理註記。");
      window.location.reload();
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "REQUEST_REJECTED",
          "操作未完成；外部副作用工作不可由此盲目重送。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="context-action-form">
      <p className="eyebrow">{item.sourceKind}</p>
      <h3>{item.itemType}</h3>
      <dl className="compact-data-list">
        <div>
          <dt>失敗分類</dt>
          <dd>{item.failureClass}</dd>
        </div>
        <div>
          <dt>嘗試次數</dt>
          <dd>{item.attemptCount}</dd>
        </div>
        <div>
          <dt>最近註記</dt>
          <dd>{item.latestAction ?? "無"}</dd>
        </div>
      </dl>
      {item.requiresReconciliation && (
        <p className="closed-note">
          此工作可能涉及外部副作用，只能走專用對帳流程，不提供盲目重送。
        </p>
      )}
      <label>
        處理理由
        <textarea
          minLength={10}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
      </label>
      <div className="page-actions">
        {item.retryable && (
          <button
            className="button"
            disabled={busy || reason.trim().length < 10}
            onClick={() => void act("retry")}
            type="button"
          >
            Fresh TOTP 後安全重算
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy || reason.trim().length < 10}
          onClick={() => void act("acknowledge")}
          type="button"
        >
          留下人工註記
        </button>
      </div>
      <p aria-live="polite">{message}</p>
    </article>
  );
}

const evidenceOptions = {
  storage_manifest_registered: ["storage_bucket", "quarantine"],
  storage_restore_verified: ["storage_bucket", "quarantine"],
  archive_reload_verified: ["archive_manifest", ""],
  deletion_tombstones_replayed: ["deletion_manifest", ""],
  audit_chain_verified: ["audit_checkpoint", ""],
  database_backup_manifest_registered: ["database", "primary"],
  database_restore_verified: ["database", "primary"],
} as const;

function EvidenceRecorder() {
  const [kind, setKind] = useState<keyof typeof evidenceOptions>(
    "storage_manifest_registered",
  );
  const [targetType, setTargetType] = useState("storage_bucket");
  const [targetIdentifier, setTargetIdentifier] = useState("quarantine");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="context-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const observedAt = new Date(String(form.get("observedAt")));
        setBusy(true);
        setMessage("等待 fresh TOTP 驗證…");
        void obtainStepUp("operations_evidence", `${kind}:${targetIdentifier}`)
          .then((stepUpNonce) =>
            postJson("/api/staff/operations/evidence", {
              evidenceKind: kind,
              targetType,
              targetIdentifier,
              outcome: form.get("outcome"),
              evidenceSha256: form.get("evidenceSha256"),
              externalReference: form.get("externalReference"),
              reason: form.get("reason"),
              observedAt: observedAt.toISOString(),
              stepUpNonce,
            }),
          )
          .then(() => {
            setMessage("證據事件已寫入；未呼叫任何外部備份或還原服務。");
            window.location.reload();
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "證據未記錄；請檢查 SHA-256、目標、時間與 fresh TOTP。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h3>登錄營運證據</h3>
      <p className="closed-note">
        這裡只登錄已由外部程序完成的證據，不會在網站內執行備份、還原或資料刪除。
      </p>
      <label>
        證據種類
        <select
          name="evidenceKind"
          onChange={(event) => {
            const nextKind = event.target.value as keyof typeof evidenceOptions;
            const [nextType, nextTarget] = evidenceOptions[nextKind];
            setKind(nextKind);
            setTargetType(nextType);
            setTargetIdentifier(nextTarget);
          }}
          value={kind}
        >
          {Object.keys(evidenceOptions).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        目標類型
        <input name="targetType" readOnly value={targetType} />
      </label>
      <label>
        目標識別
        {targetType === "storage_bucket" ? (
          <select
            name="targetIdentifier"
            onChange={(event) => setTargetIdentifier(event.target.value)}
            value={targetIdentifier}
          >
            {[
              "quarantine",
              "safe-uploads",
              "certificates",
              "legal-documents",
              "accreditation-exports",
            ].map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
        ) : (
          <input
            maxLength={100}
            name="targetIdentifier"
            onChange={(event) => setTargetIdentifier(event.target.value)}
            readOnly={targetType === "database"}
            required
            value={targetIdentifier}
          />
        )}
      </label>
      <label>
        結果
        <select name="outcome">
          <option value="passed">通過</option>
          <option value="failed">失敗</option>
        </select>
      </label>
      <label>
        證據檔 SHA-256
        <input name="evidenceSha256" pattern="[a-f0-9]{64}" required />
      </label>
      <label>
        外部證據參照
        <input
          maxLength={500}
          minLength={3}
          name="externalReference"
          required
        />
      </label>
      <label>
        觀察時間
        <input name="observedAt" required type="datetime-local" />
      </label>
      <label>
        說明
        <textarea maxLength={1000} minLength={10} name="reason" required />
      </label>
      <button className="button" disabled={busy} type="submit">
        Fresh TOTP 後登錄證據
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-TW") : "尚無證據";
}

export function OperationsControlPanel({
  workspace,
}: {
  workspace: OperationsControlPlane;
}) {
  return (
    <section
      className="workspace-section"
      aria-labelledby="operations-control-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operations Control Plane v1</p>
          <h2 id="operations-control-title">營運、事故與證據</h2>
        </div>
        <span>{new Date(workspace.generatedAt).toLocaleString("zh-TW")}</span>
      </div>

      <div className="work-queue">
        <article>
          <span>{workspace.runtime.durableDeadLetterCount}</span>
          <h3>工作 dead-letter</h3>
        </article>
        <article>
          <span>{workspace.runtime.notificationDeadLetterCount}</span>
          <h3>通知 dead-letter</h3>
        </article>
        <article>
          <span>{workspace.incidents.length}</span>
          <h3>事故紀錄</h3>
        </article>
      </div>

      <h3>事故控制</h3>
      {workspace.incidents.length ? (
        <div className="record-grid">
          {workspace.incidents.map((incident) => (
            <IncidentCase incident={incident} key={incident.id} />
          ))}
        </div>
      ) : (
        <p className="closed-note">目前沒有事故紀錄。</p>
      )}

      <h3>Dead-letter 控制</h3>
      {workspace.deadLetters.length ? (
        <div className="record-grid">
          {workspace.deadLetters.map((item) => (
            <DeadLetterCase
              item={item}
              key={`${item.sourceKind}:${item.sourceId}`}
            />
          ))}
        </div>
      ) : (
        <p className="closed-note">目前沒有 dead-letter。</p>
      )}

      <h3>備份與還原證據覆蓋</h3>
      <div className="record-grid">
        {workspace.evidence.storageBuckets.map((bucket) => (
          <article className="context-action-form" key={bucket.bucketName}>
            <h4>{bucket.bucketName}</h4>
            <p>最近 manifest：{formatTimestamp(bucket.latestManifestAt)}</p>
            <p>
              最近還原驗證：
              {formatTimestamp(bucket.latestRestoreVerifiedAt)}
            </p>
            <p>既有 manifest：{bucket.legacyManifestCount} 筆</p>
          </article>
        ))}
      </div>
      <EvidenceRecorder />
    </section>
  );
}
