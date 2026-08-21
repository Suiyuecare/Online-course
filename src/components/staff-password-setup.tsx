"use client";

import { FormEvent, useState } from "react";
import { staffPasswordSchema } from "@/domain/staff-password";
import { browserSupabase } from "@/infrastructure/supabase/browser";

export function StaffPasswordSetup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");

    if (!staffPasswordSchema.safeParse(password).success) {
      setMessage(
        "密碼需至少 14 碼，並同時包含英文大小寫、數字與符號，且不能有空白。",
      );
      return;
    }
    if (password !== confirmation) {
      setMessage("兩次輸入的密碼不一致，請重新確認。");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/staff/password/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "STAFF_PASSWORD_CHANGE_REJECTED");
      }

      const supabase = browserSupabase();
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        await supabase.auth.signOut({ scope: "local" });
        window.location.assign("/staff/login");
        return;
      }
      window.location.assign("/staff/security");
    } catch {
      setMessage("目前無法更新密碼，請稍後再試或聯絡系統管理員。");
      setBusy(false);
    }
  }

  return (
    <section className="single-step-form">
      <h2>建立你的新密碼</h2>
      <p>
        這組密碼只供你本人使用。完成後，臨時密碼會立即失效，再依下一頁設定驗證器。
      </p>
      <div className="closed-note">
        至少 14 碼，須包含英文大寫、英文小寫、數字與符號，不能包含空白。
      </div>
      <form className="staff-password-form" onSubmit={submit}>
        <label htmlFor="new-staff-password">新密碼</label>
        <input
          autoComplete="new-password"
          id="new-staff-password"
          minLength={14}
          name="password"
          required
          type="password"
        />
        <label htmlFor="confirm-staff-password">再次輸入新密碼</label>
        <input
          autoComplete="new-password"
          id="confirm-staff-password"
          minLength={14}
          name="confirmation"
          required
          type="password"
        />
        <button className="button" disabled={busy} type="submit">
          {busy ? "正在更新…" : "儲存新密碼並繼續"}
        </button>
      </form>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </section>
  );
}
