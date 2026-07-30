"use client";

import Script from "next/script";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { presentErrorCode } from "@/domain/presentation";

type Stage = "phone" | "otp" | "done";

export function PhoneLogin({
  localTestMode = false,
  turnstileSiteKey,
}: {
  localTestMode?: boolean;
  turnstileSiteKey?: string;
}) {
  const loginAvailable = Boolean(turnstileSiteKey) || localTestMode;
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (!resendAvailableAt) return;
    const update = () =>
      setResendSeconds(
        Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const localPhone = `+886${String(data.get("phone")).replace(/^0/, "")}`;
    const response = await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        phone: localPhone,
        turnstileToken: localTestMode
          ? "local-development-bypass"
          : data.get("cf-turnstile-response"),
      }),
    });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setMessage(
        presentErrorCode(
          result?.error,
          "目前無法寄出驗證碼，請稍後再試或聯絡客服。",
        ),
      );
      return;
    }
    setPhone(localPhone);
    setStage("otp");
    const cooldownSeconds = Number(result?.data?.resendAfterSeconds ?? 60);
    const expirySeconds = Number(result?.data?.expiresAfterSeconds ?? 300);
    setResendAvailableAt(Date.now() + cooldownSeconds * 1000);
    setMessage(`驗證碼已寄出，${Math.floor(expirySeconds / 60)} 分鐘內有效。`);
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const token = String(new FormData(event.currentTarget).get("token") ?? "");
    let deviceId = window.localStorage.getItem("suiyue-device-id");
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      window.localStorage.setItem("suiyue-device-id", deviceId);
    }
    const deviceHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(deviceId),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const response = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ phone, token, deviceHash }),
    });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setMessage(
        presentErrorCode(result?.error, "驗證碼不正確或已過期，請重新確認。"),
      );
      return;
    }
    setStage("done");
    window.location.assign(
      result.data?.restricted ? "/learner?restricted=1" : "/learner",
    );
  }

  return (
    <div className="auth-card">
      {turnstileSiteKey && (
        <Script
          async
          defer
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        />
      )}
      <div className="step-chip">
        {!loginAvailable
          ? "封閉展示階段"
          : stage === "phone"
            ? "步驟 1 / 2"
            : "步驟 2 / 2"}
      </div>
      <h1>
        {!loginAvailable
          ? "先用免登入導覽體驗完整平台"
          : stage === "phone"
            ? "用手機號碼登入"
            : "輸入 6 位驗證碼"}
      </h1>
      <p>
        {loginAvailable
          ? "不需要密碼。驗證碼只證明你目前能使用這個門號；系統可能要求再次確認舊資料。"
          : "為避免展示期間建立正式帳號或誤發簡訊，手機登入維持安全關閉；課程、教室、機構工作台與管理後台仍可直接完整操作。"}
      </p>
      {!loginAvailable ? (
        <div className="demo-login-bridge">
          <div className="closed-note">
            <strong>這是預期的安全狀態，不是網站故障。</strong>
            <span>正式簡訊供應商完成驗收後，才會開放學員建立帳號。</span>
          </div>
          <Link className="button" href="/demo">
            開始免登入功能導覽
          </Link>
          <Link className="button secondary" href="/courses">
            先瀏覽長照課程
          </Link>
        </div>
      ) : stage === "phone" ? (
        <form onSubmit={requestOtp}>
          <label htmlFor="phone">台灣手機號碼</label>
          <input
            autoComplete="tel"
            defaultValue={phone.replace("+886", "0")}
            id="phone"
            inputMode="tel"
            name="phone"
            pattern="09[0-9]{8}"
            placeholder="0912 345 678"
            required
          />
          {turnstileSiteKey ? (
            <div
              className="cf-turnstile"
              data-sitekey={turnstileSiteKey}
              data-theme="light"
            />
          ) : localTestMode ? (
            <div className="closed-note">
              本機測試門號：0900 000 000；驗證碼：246810。
            </div>
          ) : null}
          <button className="button" disabled={busy}>
            {busy ? "正在寄送…" : "傳送簡訊驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp}>
          <p className="phone-summary">{phone.replace("+886", "0")}</p>
          <label htmlFor="token">簡訊驗證碼</label>
          <input
            autoComplete="one-time-code"
            id="token"
            inputMode="numeric"
            maxLength={6}
            name="token"
            pattern="[0-9]{6}"
            placeholder="6 位數"
            required
          />
          <button className="button" disabled={busy}>
            {busy ? "正在確認…" : "確認並登入"}
          </button>
          <button
            className="button secondary"
            disabled={busy || resendSeconds > 0}
            onClick={() => {
              setStage("phone");
              setMessage(
                "請再次完成人機驗證，再按「傳送簡訊驗證碼」重新取得。",
              );
            }}
            type="button"
          >
            {resendSeconds > 0
              ? `${resendSeconds} 秒後可重新取得`
              : "重新取得驗證碼"}
          </button>
          <button
            className="link-button"
            onClick={() => {
              setPhone("");
              setStage("phone");
              setMessage("");
            }}
            type="button"
          >
            更換手機號碼
          </button>
        </form>
      )}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </div>
  );
}
