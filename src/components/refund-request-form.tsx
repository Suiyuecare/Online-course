"use client";

import { useState } from "react";

type RefundScope = {
  scopeType: "whole_order" | "recorded" | "live_component";
  scopeId: string | null;
  label: string;
  eligible: boolean;
  ineligibleReason: string | null;
};

export function RefundRequestForm({
  orderId,
  scopes,
}: {
  orderId: string;
  scopes: RefundScope[];
}) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const selectedScope = scopes.find(
          (scope) =>
            `${scope.scopeType}:${scope.scopeId ?? ""}` === form.get("scope"),
        );
        if (!selectedScope?.eligible) {
          setMessage("此範圍目前不能申請退款。");
          return;
        }
        void fetch(`/api/orders/${orderId}/refunds`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            basis: form.get("basis"),
            reason: form.get("reason"),
            scopes: [
              {
                scopeType: selectedScope.scopeType,
                scopeId: selectedScope.scopeId,
              },
            ],
            bankName: form.get("bankName"),
            bankCode: form.get("bankCode"),
            accountNumber: form.get("accountNumber"),
            accountName: form.get("accountName"),
          }),
        })
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error("REJECTED");
            setMessage(
              `退款案件已建立，受影響範圍已立即凍結；試算 NT$ ${result.data.calculatedAmountTwd}，仍待人工雙人審核與實際匯回。`,
            );
          })
          .catch(() => setMessage("退款申請未建立；請檢查範圍與帳戶資料。"));
      }}
    >
      <h2>申請人工退款</h2>
      <p>送出後只凍結選擇的範圍；駁回才恢復。匯回前不會標示退款完成。</p>
      <label>
        退款依據
        <select name="basis">
          <option value="consumer_withdrawal">消費者解約</option>
          <option value="proportional_termination">比例終止</option>
          <option value="accreditation_failure">積分核定問題</option>
          <option value="provider_failure">供應商服務失敗</option>
          <option value="suiyue_cancellation">歲悅取消</option>
          <option value="material_change">重大變更</option>
          <option value="other">其他</option>
        </select>
      </label>
      <label>
        退款範圍
        <select name="scope" required defaultValue="">
          <option value="" disabled>
            請選擇
          </option>
          {scopes.map((scope) => (
            <option
              disabled={!scope.eligible}
              key={`${scope.scopeType}:${scope.scopeId ?? ""}`}
              value={`${scope.scopeType}:${scope.scopeId ?? ""}`}
            >
              {scope.label}
              {scope.eligible
                ? ""
                : `（${scope.ineligibleReason ?? "目前不可申請"}）`}
            </option>
          ))}
        </select>
      </label>
      <label>
        原因（至少 10 字）
        <textarea name="reason" minLength={10} required />
      </label>
      <label>
        匯回銀行
        <input name="bankName" required />
      </label>
      <label>
        銀行代碼
        <input
          name="bankCode"
          inputMode="numeric"
          pattern="[0-9]{3}"
          required
        />
      </label>
      <label>
        匯回帳號
        <input
          name="accountNumber"
          inputMode="numeric"
          pattern="[0-9]{6,20}"
          required
        />
      </label>
      <label>
        戶名
        <input name="accountName" required />
      </label>
      <button className="button secondary" type="submit">
        建立退款案件並凍結範圍
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
