"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  isProtectedStaffMetadata,
  mustChangeStaffPassword,
} from "@/domain/staff-password";
import { browserSupabase } from "@/infrastructure/supabase/browser";

const educationQualityEmail = "edu.control@suiyuecare.com";

export function StaffEmailLogin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const form = new FormData(event.currentTarget);
      const supabase = browserSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? "")
          .trim()
          .toLowerCase(),
        password: String(form.get("password") ?? ""),
      });

      if (error || !data.user) throw new Error("STAFF_SIGN_IN_REJECTED");
      if (!isProtectedStaffMetadata(data.user.app_metadata)) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("STAFF_SIGN_IN_REJECTED");
      }

      window.location.assign(
        mustChangeStaffPassword(data.user.app_metadata)
          ? "/staff/password"
          : "/staff/security",
      );
    } catch {
      setMessage(
        "帳號或密碼不正確，請重新確認；仍無法登入時請聯絡系統管理員。",
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="step-chip">工作人員專用</div>
      <h1>登入課程管理後台</h1>
      <p>
        使用公司核發的職員帳號與密碼。第一次登入會先要求更換臨時密碼，再設定驗證器。
      </p>
      <form onSubmit={submit}>
        <label htmlFor="staff-email">公司電子信箱</label>
        <input
          autoCapitalize="none"
          autoComplete="username"
          defaultValue={educationQualityEmail}
          id="staff-email"
          inputMode="email"
          name="email"
          required
          spellCheck={false}
          type="email"
        />
        <label htmlFor="staff-password">密碼</label>
        <input
          autoComplete="current-password"
          id="staff-password"
          name="password"
          required
          type="password"
        />
        <button className="button" disabled={busy} type="submit">
          {busy ? "登入中…" : "登入後台"}
        </button>
      </form>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
      <Link className="button secondary" href="/login">
        返回學員手機登入
      </Link>
    </div>
  );
}
