"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type RefundScope = {
  scopeType: "whole_order" | "recorded" | "live_component";
  scopeId: string | null;
  label: string;
  eligible: boolean;
  ineligibleReason: string | null;
};

type Feedback = {
  tone: "info" | "success" | "error";
  text: string;
};

function responseError(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return null;
}

function calculatedRefund(payload: unknown): number | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("calculatedAmountTwd" in payload.data) ||
    typeof payload.data.calculatedAmountTwd !== "number" ||
    !Number.isInteger(payload.data.calculatedAmountTwd) ||
    payload.data.calculatedAmountTwd <= 0
  ) {
    return null;
  }
  return payload.data.calculatedAmountTwd;
}

export function RefundRequestForm({
  orderId,
  scopes,
}: {
  orderId: string;
  scopes: RefundScope[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submissionIdentity = useRef<{
    signature: string;
    idempotencyKey: string;
  } | null>(null);

  async function submitRefund(form: FormData) {
    if (busy || submitted) return;
    const selectedScope = scopes.find(
      (scope) =>
        `${scope.scopeType}:${scope.scopeId ?? ""}` === form.get("scope"),
    );
    if (!selectedScope?.eligible) {
      setMessage({
        tone: "error",
        text: "此範圍目前不能申請退款，資料沒有送出。",
      });
      return;
    }
    const payload = {
      basis: String(form.get("basis") ?? ""),
      reason: String(form.get("reason") ?? ""),
      scopes: [
        {
          scopeType: selectedScope.scopeType,
          scopeId: selectedScope.scopeId,
        },
      ],
      bankName: String(form.get("bankName") ?? ""),
      bankCode: String(form.get("bankCode") ?? ""),
      accountNumber: String(form.get("accountNumber") ?? ""),
      accountName: String(form.get("accountName") ?? ""),
    };
    const signature = JSON.stringify(payload);
    if (submissionIdentity.current?.signature !== signature) {
      submissionIdentity.current = {
        signature,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    const idempotencyKey = submissionIdentity.current.idempotencyKey;
    setBusy(true);
    setMessage({ tone: "info", text: "正在建立退款案件，請勿重複送出…" });
    try {
      const response = await fetch(`/api/orders/${orderId}/refunds`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const result: unknown = await response.json().catch(() => null);
      const calculatedAmount = calculatedRefund(result);
      if (!response.ok || calculatedAmount === null) {
        const code = responseError(result);
        setMessage({
          tone: "error",
          text:
            response.status === 401
              ? "登入已失效，退款申請沒有送出。請重新登入後再試。"
              : code === "REFUND_REQUEST_NOT_AUTHORIZED"
                ? "訂單狀態已變更，目前不能由此申請退款；請重新整理確認。"
                : response.status >= 500 || result === null
                  ? "服務暫時沒有正確回應，案件是否建立尚未確認。表單資料仍保留，請按同一按鈕重試。"
                  : "退款申請未建立。請檢查退款範圍、原因與帳戶資料後重試。",
        });
        return;
      }
      setSubmitted(true);
      setMessage({
        tone: "success",
        text: `退款案件已建立，受影響範圍已立即凍結；試算 NT$ ${calculatedAmount.toLocaleString("zh-TW")}，仍待人工雙人審核與實際匯回。`,
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "送出時連線中斷，案件是否建立尚未確認。表單資料仍保留，請按同一按鈕重試。",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-busy={busy}
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submitRefund(new FormData(event.currentTarget));
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
      <button
        className="button secondary"
        disabled={busy || submitted}
        type="submit"
      >
        {busy
          ? "建立案件中…"
          : submitted
            ? "退款案件已建立"
            : "建立退款案件並凍結範圍"}
      </button>
      <p
        aria-live={message?.tone === "error" ? "assertive" : "polite"}
        className={
          message?.tone === "error"
            ? "flow-message flow-message-error"
            : "flow-message"
        }
        role={message?.tone === "error" ? "alert" : "status"}
      >
        {message?.text}
      </p>
    </form>
  );
}
