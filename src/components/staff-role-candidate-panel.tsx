"use client";

import { useMemo, useState } from "react";
import type {
  StaffRole,
  StaffRoleCandidate,
} from "@/application/staff-role-directory";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

const roleLabels: Record<StaffRole, string> = {
  instructor: "講師",
  course_admin: "課程管理員",
  accreditation_reviewer: "積分審核員",
  finance: "財務",
  support: "客服",
  platform_admin: "平台管理員",
};

async function requestRole(input: {
  personId: string;
  role: StaffRole;
  reason: string;
}) {
  const stepUpNonce = await obtainStepUp(
    "role_change",
    `${input.personId}:${input.role}:grant`,
  );
  const response = await fetch("/api/staff/roles/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      subjectPersonId: input.personId,
      role: input.role,
      action: "grant",
      reason: input.reason,
      stepUpNonce,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "ROLE_CHANGE_REQUEST_REJECTED");
  }
  return result?.data;
}

function CandidateCard({ candidate }: { candidate: StaffRoleCandidate }) {
  const availableRoles = useMemo(
    () =>
      (Object.keys(roleLabels) as StaffRole[]).filter(
        (role) =>
          !candidate.currentRoles.includes(role) &&
          !candidate.pendingRoles.includes(role),
      ),
    [candidate.currentRoles, candidate.pendingRoles],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <article className="context-action-form">
      <div className="section-heading">
        <div>
          <h3>{candidate.displayName}</h3>
          <p>
            {candidate.maskedPhone}
            {candidate.maskedEmail ? `・${candidate.maskedEmail}` : ""}
          </p>
        </div>
        <span className="status status-neutral">
          {candidate.currentRoles.length > 0 ? "已有後台角色" : "一般帳號"}
        </span>
      </div>
      <dl className="compact-data-list">
        <div>
          <dt>目前角色</dt>
          <dd>
            {candidate.currentRoles.length > 0
              ? candidate.currentRoles
                  .map((role) => roleLabels[role])
                  .join("、")
              : "無"}
          </dd>
        </div>
        <div>
          <dt>待覆核</dt>
          <dd>
            {candidate.pendingRoles.length > 0
              ? candidate.pendingRoles
                  .map((role) => roleLabels[role])
                  .join("、")
              : "無"}
          </dd>
        </div>
      </dl>
      {availableRoles.length === 0 ? (
        <p className="closed-note">目前沒有可再授予的角色。</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const role = String(form.get("role")) as StaffRole;
            const reason = String(form.get("reason") ?? "").trim();
            setBusy(true);
            setMessage("請完成 fresh TOTP；送出後仍需另一位管理員覆核。");
            void requestRole({
              personId: candidate.personId,
              role,
              reason,
            })
              .then(() => {
                setMessage("角色申請已建立，等待另一位平台管理員覆核。");
                window.location.reload();
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "角色申請未建立；請確認 fresh TOTP、理由與候選人狀態。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            要授予的角色
            <select defaultValue="" name="role" required>
              <option disabled value="">
                請選擇
              </option>
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          <label>
            授權理由
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? "驗證並建立中…" : "建立雙人覆核申請"}
          </button>
        </form>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function StaffRoleCandidatePanel({
  candidates,
}: {
  candidates: StaffRoleCandidate[];
}) {
  return (
    <section className="workspace-section" aria-labelledby="staff-directory">
      <div className="section-heading">
        <div>
          <p className="eyebrow">後台授權</p>
          <h2 id="staff-directory">從一般帳號授予後台角色</h2>
        </div>
        <span>{candidates.length} 個帳號</span>
      </div>
      <div className="warning-panel">
        <strong>授權不會立即生效</strong>
        <p>
          申請人先以 fresh TOTP 建立申請，另一位平台管理員再以自己的 fresh TOTP
          覆核；系統不提供單人繞過方式。
        </p>
      </div>
      {candidates.length === 0 ? (
        <p className="closed-note">
          沒有符合搜尋條件的帳號；可用上方搜尋輸入姓名、Email 或完整手機號碼。
        </p>
      ) : (
        <div className="record-grid">
          {candidates.map((candidate) => (
            <CandidateCard candidate={candidate} key={candidate.personId} />
          ))}
        </div>
      )}
    </section>
  );
}
