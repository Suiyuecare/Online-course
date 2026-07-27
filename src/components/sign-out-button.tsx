"use client";

import { useState } from "react";
import { presentErrorCode } from "@/domain/presentation";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <span className="sign-out-control">
      <button
        className={compact ? "link-button nav-sign-out" : "button secondary"}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage("");
          void fetch("/api/auth/logout", {
            method: "POST",
            headers: { "idempotency-key": crypto.randomUUID() },
          })
            .then(async (response) => {
              const result = await response.json().catch(() => null);
              if (!response.ok) {
                throw new Error(result?.error ?? "SIGN_OUT_REJECTED");
              }
              window.location.assign("/");
            })
            .catch((error: Error) => {
              setMessage(
                presentErrorCode(
                  error.message,
                  "目前無法登出，請重新整理後再試。",
                ),
              );
              setBusy(false);
            });
        }}
        type="button"
      >
        {busy ? "登出中…" : "登出"}
      </button>
      {message && (
        <span aria-live="polite" className="visually-inline-message">
          {message}
        </span>
      )}
    </span>
  );
}
