"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NotificationReadButton({
  notificationId,
}: {
  notificationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch(`/api/notifications/${notificationId}/read`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        })
          .then((response) => {
            if (!response.ok) throw new Error("REJECTED");
            router.refresh();
          })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
      type="button"
    >
      {busy ? "儲存中…" : "標記已讀"}
    </button>
  );
}
