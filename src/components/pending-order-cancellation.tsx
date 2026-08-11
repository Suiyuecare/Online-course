"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Feedback = {
  tone: "info" | "success" | "error";
  text: string;
};

function errorCode(payload: unknown): string | null {
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

function isCancelled(payload: unknown) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    typeof payload.data === "object" &&
    payload.data !== null &&
    "status" in payload.data &&
    payload.data.status === "cancelled"
  );
}

export function PendingOrderCancellation({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<Feedback | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  async function cancelOrder() {
    if (busy || completed) return;
    setBusy(true);
    setMessage({ tone: "info", text: "正在取消訂單並釋放保留資源…" });
    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify({ confirmed: true }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !isCancelled(result)) {
        const code = errorCode(result);
        setMessage({
          tone: "error",
          text:
            response.status === 401
              ? "登入已失效，訂單沒有取消。請重新登入後再試。"
              : code === "ORDER_CANCELLATION_NOT_AVAILABLE"
                ? "訂單狀態已變更，不能自行取消。若已匯款或已送核對資料，請聯絡客服。"
                : response.status >= 500 || result === null
                  ? "服務暫時沒有正確回應，取消結果尚未確認。請按同一按鈕重試。"
                  : "目前無法取消這筆訂單；訂單仍維持原狀，請重新整理或聯絡客服。",
        });
        return;
      }
      setCompleted(true);
      setMessage({
        tone: "success",
        text: "訂單已取消；未使用的折扣券與直播保留位已釋放，可購買的課程也會放回購物車。",
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "取消時連線中斷，結果尚未確認。請按同一按鈕重試，系統不會重複取消。",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-busy={busy}
      className="pending-order-cancellation"
      aria-labelledby={`cancel-order-heading-${orderId}`}
    >
      <h2 id={`cancel-order-heading-${orderId}`}>不再購買這堂課？</h2>
      <p>
        只有尚未匯款、尚未送出核對資料的訂單可自行取消。取消後會釋放折扣券與直播名額；付款與操作紀錄仍依法保留。
      </p>
      {!confirming ? (
        <button
          className="button secondary"
          disabled={completed}
          onClick={() => {
            setConfirming(true);
            setMessage(null);
          }}
          type="button"
        >
          取消這筆待匯款訂單
        </button>
      ) : (
        <div className="pending-order-cancellation-confirmation">
          <strong>請再次確認：我尚未進行匯款。</strong>
          <p>若已匯款，請不要取消，改由客服協助對帳。</p>
          <div>
            <button
              className="button danger"
              disabled={busy || completed}
              onClick={() => void cancelOrder()}
              type="button"
            >
              {busy ? "取消處理中…" : completed ? "訂單已取消" : "確認取消訂單"}
            </button>
            <button
              className="button secondary"
              disabled={busy || completed}
              onClick={() => {
                setConfirming(false);
                setMessage(null);
              }}
              type="button"
            >
              保留訂單
            </button>
          </div>
        </div>
      )}
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
    </section>
  );
}
