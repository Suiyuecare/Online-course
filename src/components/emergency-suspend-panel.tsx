"use client";

import { useState } from "react";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

export function EmergencySuspendPanel() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="single-step-form danger-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (
          !window.confirm(
            "確定立即暫停收款核銷、敏感匯出與發證入口？此操作會建立資安事故紀錄。",
          )
        ) {
          return;
        }
        setBusy(true);
        setMessage("正在驗證並執行緊急暫停…");
        void obtainStepUp("emergency_suspend", "all")
          .then((nonce) =>
            fetch("/api/staff/security/emergency-suspend", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              },
              body: JSON.stringify({
                reason: form.get("reason"),
                stepUpNonce: nonce,
              }),
            }),
          )
          .then(async (response) => {
            const result = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(result?.error ?? "EMERGENCY_SUSPEND_REJECTED");
            }
            setMessage(
              "高風險入口已暫停並建立事故案件；請依事故處理清單進行對帳與復原。",
            );
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "緊急暫停未執行；請確認 platform admin、AAL2 與 fresh TOTP。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2>緊急暫停高風險入口</h2>
      <p>
        只在疑似個資越權、錯誤開通、錯誤發證或金流事故時使用；原始證據與既有紀錄不會刪除。
      </p>
      <label>
        事故原因與目前證據
        <textarea name="reason" minLength={10} maxLength={1000} required />
      </label>
      <button className="button" disabled={busy} type="submit">
        {busy ? "執行中…" : "Fresh TOTP 後立即暫停"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
