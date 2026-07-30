"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const messages: Record<string, string> = {
  COUPON_CODE_NOT_AVAILABLE: "這組折扣碼無法領取，可能已失效、額滿或輸入錯誤。",
  B2C_COMMERCE_CLOSED: "目前暫停領取折扣券，已領取的紀錄不會消失。",
  RATE_LIMITED: "嘗試次數太多，請稍後再試。",
  EMERGENCY_CLOSED: "系統目前暫停交易操作，請稍後再試。",
};

export function CouponCodeForm() {
  const router = useRouter();
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function claimCoupon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSuccess(false);
    try {
      const response = await fetch("/api/coupons/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ code }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "COUPON_CLAIM_REJECTED");
      }
      setCode("");
      setSuccess(true);
      setMessage(
        result?.data?.alreadyClaimed
          ? "這張折扣券已經在你的帳號裡。"
          : "折扣券已成功加入，可以在購課時選用。",
      );
      router.refresh();
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message.split(":")[0]
          : "COUPON_CLAIM_REJECTED";
      setMessage(messages[code] ?? "目前無法加入折扣券，請稍後再試。");
    } finally {
      setBusy(false);
      window.setTimeout(() => messageRef.current?.focus(), 0);
    }
  }

  return (
    <form className="learner-coupon-code-form" onSubmit={claimCoupon}>
      <label htmlFor="coupon-code">輸入折扣碼</label>
      <div>
        <input
          autoCapitalize="characters"
          autoComplete="off"
          id="coupon-code"
          maxLength={32}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          pattern="[A-Za-z0-9-]{4,32}"
          placeholder="例如：SUIYUE85"
          required
          spellCheck={false}
          value={code}
        />
        <button className="button" disabled={busy} type="submit">
          {busy ? "加入中…" : "加入折扣券"}
        </button>
      </div>
      <p
        className={success ? "success-text" : "error-text"}
        ref={messageRef}
        role="status"
        tabIndex={-1}
      >
        {message}
      </p>
    </form>
  );
}
