"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NotificationReadButton({
  notificationId,
  markAll = false,
}: {
  notificationId?: string;
  markAll?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const path = markAll
    ? "/api/notifications/read-all"
    : `/api/notifications/${notificationId}/read`;

  return (
    <span className="notification-read-control">
      <button
        className={markAll ? "button secondary" : "text-button"}
        disabled={busy || (!markAll && !notificationId)}
        onClick={() => {
          setBusy(true);
          setMessage("");
          void fetch(path, {
            method: "POST",
            headers: { "idempotency-key": crypto.randomUUID() },
          })
            .then(async (response) => {
              const result = await response.json().catch(() => null);
              if (!response.ok)
                throw new Error(result?.error ?? "READ_REJECTED");
              setMessage(markAll ? "所有未讀通知已標記。" : "已標記為已讀。");
              router.refresh();
            })
            .catch(() =>
              setMessage("目前無法更新已讀狀態，通知仍保留，請稍後再試。"),
            )
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? "儲存中…" : markAll ? "全部標記已讀" : "標記已讀"}
      </button>
      {message && (
        <small aria-live="polite" className="notification-read-message">
          {message}
        </small>
      )}
    </span>
  );
}
