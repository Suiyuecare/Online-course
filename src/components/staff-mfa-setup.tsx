"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { staffBrowserSupabase } from "@/infrastructure/supabase/step-up-client";

export function StaffMfaSetup() {
  const [verified, setVerified] = useState(false);
  const [existingFactorId, setExistingFactorId] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [factor, setFactor] = useState<{
    id: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [message, setMessage] = useState("正在檢查 TOTP 狀態…");

  useEffect(() => {
    const supabase = staffBrowserSupabase();
    void Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
      .then(([factors, assurance]) => {
        if (factors.error || assurance.error) {
          throw new Error("MFA_STATUS_UNAVAILABLE");
        }
        const readyFactor = factors.data?.totp.find(
          (item) => item.status === "verified",
        );
        const pendingFactor = readyFactor
          ? undefined
          : factors.data?.all.find(
              (item) =>
                item.factor_type === "totp" && item.status === "unverified",
            );
        const elevated = assurance.data?.currentLevel === "aal2";
        setVerified(elevated);
        setExistingFactorId(elevated ? null : (readyFactor?.id ?? null));
        setPendingFactorId(elevated ? null : (pendingFactor?.id ?? null));
        setMessage(
          elevated
            ? "本次登入已完成 TOTP 驗證。"
            : readyFactor
              ? "請輸入驗證器 App 的六位數驗證碼以進入後台。"
              : pendingFactor
                ? "上次的驗證器設定尚未完成，請重新設定。"
                : "尚未設定 TOTP。",
        );
      })
      .catch(() => setMessage("目前無法檢查驗證器狀態，請重新整理頁面再試。"));
  }, []);

  async function enroll() {
    setBusy(true);
    const supabase = staffBrowserSupabase();
    try {
      if (pendingFactorId) {
        const { error: resetError } = await supabase.auth.mfa.unenroll({
          factorId: pendingFactorId,
        });
        if (resetError) throw new Error("MFA_RESET_REJECTED");
        setPendingFactorId(null);
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "歲悅學苑工作人員",
      });
      if (error) throw new Error("MFA_ENROLL_REJECTED");
      setFactor({
        id: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setMessage("請用驗證器 App 掃描，再輸入六位數驗證碼。");
    } catch {
      setMessage(
        "無法重新設定驗證器，請重新整理頁面再試。仍失敗時請聯絡系統管理員。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyFactor(factorId: string, code: string) {
    setBusy(true);
    const supabase = staffBrowserSupabase();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setMessage("無法開始驗證，請稍後再試。");
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (error) {
      setMessage("驗證碼錯誤或已過期。");
      setBusy(false);
      return;
    }
    setVerified(true);
    setFactor(null);
    setExistingFactorId(null);
    setMessage("TOTP 已驗證；現在可以進入工作人員後台。");
    setBusy(false);
  }

  async function verify(code: string) {
    if (!factor) return;
    await verifyFactor(factor.id, code);
  }

  return (
    <section className="single-step-form">
      <h2>工作人員 TOTP</h2>
      <p>
        完成第一階段登入後，後台還需要驗證器 App 的 TOTP。
        敏感操作仍會要求當下再驗證一次。
      </p>
      {!verified &&
        !factor &&
        (existingFactorId ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verifyFactor(
                existingFactorId,
                String(new FormData(event.currentTarget).get("code")),
              );
            }}
          >
            <label>
              六位數驗證碼
              <input
                autoComplete="one-time-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                disabled={busy}
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "驗證中…" : "驗證並進入後台"}
            </button>
          </form>
        ) : (
          <button
            className="button"
            disabled={busy}
            onClick={() => void enroll()}
          >
            {busy
              ? "設定中…"
              : pendingFactorId
                ? "重新設定驗證器"
                : "開始設定驗證器"}
          </button>
        ))}
      {factor && (
        <>
          {/* Supabase generates this data URI locally for the enrolled factor. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="TOTP 設定 QR Code"
            className="totp-qr"
            src={factor.qrCode}
          />
          <p>
            無法掃描時，手動輸入：<code>{factor.secret}</code>
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verify(
                String(new FormData(event.currentTarget).get("code")),
              );
            }}
          >
            <label>
              六位數驗證碼
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                disabled={busy}
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy ? "驗證中…" : "驗證並啟用"}
            </button>
          </form>
        </>
      )}
      {verified && (
        <Link className="button" href="/staff">
          進入後台
        </Link>
      )}
      <p aria-live="polite">{message}</p>
    </section>
  );
}
