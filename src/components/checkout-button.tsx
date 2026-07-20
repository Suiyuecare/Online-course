"use client";

import { useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";

export function CheckoutButton({
  courseSlug,
  liveSessionId,
}: {
  courseSlug: string;
  liveSessionId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function startCheckout() {
    setBusy(true);
    setMessage("");
    try {
      const storageKey = `checkout:${courseSlug}:${liveSessionId ?? "recorded"}`;
      const idempotencyKey =
        sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, idempotencyKey);
      const response = await fetch("/api/payments/ecpay/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseSlug, liveSessionId, idempotencyKey }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(
          result.message ??
            (response.status === 401
              ? "請先登入再付款。"
              : "目前無法建立測試訂單，請稍後再試。"),
        );
        return;
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.action;
      Object.entries(result.fields as Record<string, string>).forEach(
        ([name, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        },
      );
      document.body.appendChild(form);
      form.submit();
    } catch {
      setMessage("網路連線異常，訂單尚未建立，請重試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={busy}
        className="button-primary button-large w-full"
      >
        {busy ? (
          <LoaderCircle className="size-5 animate-spin" />
        ) : (
          <CreditCard className="size-5" />
        )}
        {busy
          ? "正在前往綠界…"
          : liveSessionId
            ? "保留座位並前往付款"
            : "前往綠界測試付款"}
      </button>
      {liveSessionId && (
        <p className="mt-2 text-center text-xs font-bold text-slate-500">
          座位保留 15 分鐘，付款成功後才正式占位。
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900"
        >
          {message}
        </p>
      )}
    </div>
  );
}
