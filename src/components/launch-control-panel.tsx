"use client";

import { useState } from "react";
import type { LaunchControlWorkspace } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

const providerLabels: Record<string, string> = {
  supabase_phone_auth: "Supabase 手機驗證",
  twilio_verify: "Twilio Verify",
  cloudflare_stream: "Cloudflare Stream",
  zoom_oauth: "Zoom OAuth",
  zoom_meeting_sdk: "Zoom Meeting SDK",
  resend: "Resend",
  managed_kms: "託管金鑰服務",
  malware_scanner: "惡意程式掃描",
  external_monitor: "外部監控",
};

const settingLabels: Record<string, string> = {
  legal_approved: "法務文件已核准",
  finance_configured: "財務流程已設定",
  incident_owner_configured: "資安事故負責人已設定",
  bank_account: "人工匯款帳戶",
  finance_high_value_threshold: "高額匯款雙人門檻",
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

function displayValue(value: Record<string, unknown> | null) {
  if (!value) return "尚未設定";
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join("／");
}

export function LaunchControlPanel({
  workspace,
}: {
  workspace: LaunchControlWorkspace;
}) {
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
            "操作未完成；請確認角色、雙人覆核與資料內容。",
          ),
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      <div className="warning-panel">
        <strong>正式營運開關採雙人覆核</strong>
        <p>
          建立者不能核准自己的申請。人工匯款帳號不會透過讀取 API
          回傳完整帳號，供應商也只有在健康檢查仍新鮮時才能通過正式驗證。
        </p>
      </div>

      <section className="single-step-form">
        <h2>目前營運設定</h2>
        <dl className="compact-data-list">
          {workspace.settings.map((setting) => (
            <div key={setting.key}>
              <dt>{setting.label}</dt>
              <dd>
                {displayValue(setting.value)}
                {setting.revision
                  ? `（revision ${setting.revision}，${new Date(
                      setting.effectiveAt ?? "",
                    ).toLocaleString("zh-TW")} 生效）`
                  : ""}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            () =>
              post("/api/staff/settings", {
                settingKey: form.get("settingKey"),
                enabled: form.get("enabled") === "true",
                effectiveAt: asIso(form.get("effectiveAt")),
                reason: form.get("reason"),
              }),
            "布林營運設定已送交第二位平台管理員",
          );
        }}
      >
        <h2>提出營運開關變更</h2>
        <label>
          設定
          <select name="settingKey" required>
            <option value="legal_approved">法務文件已核准</option>
            <option value="finance_configured">財務流程已設定</option>
            <option value="incident_owner_configured">
              資安事故負責人已設定
            </option>
          </select>
        </label>
        <label>
          新值
          <select name="enabled" required>
            <option value="true">是，開啟</option>
            <option value="false">否，關閉</option>
          </select>
        </label>
        <label>
          預定生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          變更理由
          <textarea name="reason" minLength={10} maxLength={1000} required />
        </label>
        <button className="button" disabled={busy} type="submit">
          送交第二人覆核
        </button>
      </form>

      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            () =>
              post("/api/staff/settings", {
                settingKey: "bank_account",
                bankName: form.get("bankName"),
                bankCode: form.get("bankCode"),
                accountName: form.get("accountName"),
                accountNumber: form.get("accountNumber"),
                effectiveAt: asIso(form.get("effectiveAt")),
                reason: form.get("reason"),
              }),
            "匯款帳戶變更已送交第二位平台管理員",
          );
        }}
      >
        <h2>提出人工匯款帳戶變更</h2>
        <label>
          銀行名稱
          <input name="bankName" minLength={2} maxLength={100} required />
        </label>
        <label>
          銀行代碼
          <input
            autoComplete="off"
            inputMode="numeric"
            name="bankCode"
            pattern="\d{3}"
            required
          />
        </label>
        <label>
          戶名
          <input name="accountName" minLength={2} maxLength={100} required />
        </label>
        <label>
          完整帳號（送出後只顯示遮罩）
          <input
            autoComplete="off"
            inputMode="numeric"
            name="accountNumber"
            minLength={5}
            maxLength={30}
            required
          />
        </label>
        <label>
          預定生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          變更理由
          <textarea name="reason" minLength={10} maxLength={1000} required />
        </label>
        <button className="button" disabled={busy} type="submit">
          送交第二人覆核
        </button>
      </form>

      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            () =>
              post("/api/staff/settings", {
                settingKey: "finance_high_value_threshold",
                amountTwd: Number(form.get("amountTwd")),
                effectiveAt: asIso(form.get("effectiveAt")),
                reason: form.get("reason"),
              }),
            "高額匯款門檻已送交第二位平台管理員",
          );
        }}
      >
        <h2>提出高額匯款門檻變更</h2>
        <label>
          金額（新台幣）
          <input
            inputMode="numeric"
            max={100000000}
            min={1}
            name="amountTwd"
            type="number"
            required
          />
        </label>
        <label>
          預定生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          變更理由
          <textarea name="reason" minLength={10} maxLength={1000} required />
        </label>
        <button className="button" disabled={busy} type="submit">
          送交第二人覆核
        </button>
      </form>

      <section className="single-step-form">
        <h2>待覆核營運設定</h2>
        {workspace.settingRequests.length === 0 && (
          <p className="closed-note">目前沒有待覆核設定。</p>
        )}
        {workspace.settingRequests.map((request) => (
          <form
            className="context-action-form"
            key={request.id}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const decision = String(form.get("decision"));
              run(
                async () =>
                  post(`/api/staff/settings/${request.id}/decision`, {
                    decision,
                    reason: form.get("reason"),
                    stepUpNonce: await obtainStepUp(
                      "platform_prerequisite_review",
                      request.id,
                    ),
                  }),
                decision === "approve" ? "設定已核准" : "設定已拒絕",
              );
            }}
          >
            <strong>
              {settingLabels[request.settingKey] ?? request.settingKey}
            </strong>
            <p>
              申請人：{request.requesterLabel}；預定生效：
              {new Date(request.effectiveAt).toLocaleString("zh-TW")}
            </p>
            <p>新值：{displayValue(request.proposedValue)}</p>
            <p>申請理由：{request.requestReason}</p>
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
              <p className="closed-note">建立者不可覆核自己的申請。</p>
            )}
          </form>
        ))}
      </section>

      <section className="single-step-form">
        <h2>供應商健康與正式驗證</h2>
        <dl className="compact-data-list">
          {workspace.providers.map((provider) => (
            <div key={provider.provider}>
              <dt>{providerLabels[provider.provider] ?? provider.provider}</dt>
              <dd>
                健康狀態：{provider.status}；最近檢查：
                {provider.checkedAt
                  ? new Date(provider.checkedAt).toLocaleString("zh-TW")
                  : "尚無"}
                ；正式證據覆核：
                {provider.productionValidatedAt
                  ? new Date(provider.productionValidatedAt).toLocaleString(
                      "zh-TW",
                    )
                  : "尚未"}
                ；有效至：
                {provider.productionValidationExpiresAt
                  ? new Date(
                      provider.productionValidationExpiresAt,
                    ).toLocaleString("zh-TW")
                  : "尚無期限"}
                （{provider.validationCurrent ? "目前有效" : "已失效"}）
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            () =>
              post("/api/staff/providers/validations", {
                provider: form.get("provider"),
                evidenceReference: form.get("evidenceReference"),
                evidenceSha256: form.get("evidenceSha256"),
                testedAt: asIso(form.get("testedAt")),
                reason: form.get("reason"),
              }),
            "正式環境驗證證據已送交第二位平台管理員",
          );
        }}
      >
        <h2>提出供應商正式環境驗證</h2>
        <label>
          供應商
          <select name="provider" required>
            {workspace.providers.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {providerLabels[provider.provider] ?? provider.provider}
              </option>
            ))}
          </select>
        </label>
        <label>
          證據位置／工單編號
          <input
            name="evidenceReference"
            minLength={3}
            maxLength={500}
            required
          />
        </label>
        <label>
          證據 SHA-256（64 位小寫十六進位）
          <input
            autoComplete="off"
            name="evidenceSha256"
            pattern="[a-f0-9]{64}"
            required
          />
        </label>
        <label>
          正式環境測試時間
          <input name="testedAt" type="datetime-local" required />
        </label>
        <label>
          送審理由
          <textarea name="reason" minLength={10} maxLength={1000} required />
        </label>
        <button className="button" disabled={busy} type="submit">
          送交第二人覆核
        </button>
      </form>

      <section className="single-step-form">
        <h2>待覆核供應商證據</h2>
        {workspace.providerRequests.length === 0 && (
          <p className="closed-note">目前沒有待覆核證據。</p>
        )}
        {workspace.providerRequests.map((request) => (
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
                    `/api/staff/providers/validations/${request.id}/decision`,
                    {
                      decision,
                      reason: form.get("reason"),
                      stepUpNonce: await obtainStepUp(
                        "platform_prerequisite_review",
                        request.id,
                      ),
                    },
                  ),
                decision === "approve"
                  ? "供應商正式驗證已核准"
                  : "供應商正式驗證已拒絕",
              );
            }}
          >
            <strong>
              {providerLabels[request.provider] ?? request.provider}
            </strong>
            <p>
              申請人：{request.requesterLabel}；測試時間：
              {new Date(request.testedAt).toLocaleString("zh-TW")}
            </p>
            <p>
              證據有效至：
              {new Date(request.evidenceExpiresAt).toLocaleString("zh-TW")}
              {!request.canApprove && request.canDecide
                ? "（證據已過期、測試時間在未來，或健康檢查不新鮮；只能拒絕）"
                : ""}
            </p>
            <p>證據：{request.evidenceReference}</p>
            <p>SHA-256：{request.evidenceSha256}</p>
            <p>申請理由：{request.requestReason}</p>
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
                    disabled={busy || !request.canApprove}
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
              <p className="closed-note">建立者不可覆核自己的證據。</p>
            )}
          </form>
        ))}
      </section>

      <p aria-live="polite" className="flow-message" role="status">
        {message}
      </p>
    </div>
  );
}
