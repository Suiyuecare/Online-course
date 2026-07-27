"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { staffBrowserSupabase } from "@/infrastructure/supabase/step-up-client";

export function StaffMfaSetup() {
  const [verified, setVerified] = useState(false);
  const [factor, setFactor] = useState<{
    id: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [message, setMessage] = useState("正在檢查 TOTP 狀態…");

  useEffect(() => {
    void staffBrowserSupabase()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        const ready = data?.totp.some((item) => item.status === "verified");
        setVerified(Boolean(ready));
        setMessage(ready ? "TOTP 已設定。" : "尚未設定 TOTP。");
      });
  }, []);

  async function enroll() {
    const { data, error } = await staffBrowserSupabase().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "歲悅學苑工作人員",
    });
    if (error) {
      setMessage("無法開始設定；若已有未驗證 factor，請先於帳號中移除。");
      return;
    }
    setFactor({
      id: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setMessage("請用驗證器 App 掃描，再輸入六位數驗證碼。");
  }

  async function verify(code: string) {
    if (!factor) return;
    const supabase = staffBrowserSupabase();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) {
      setMessage("TOTP challenge 建立失敗。");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code,
    });
    if (error) {
      setMessage("驗證碼錯誤或已過期。");
      return;
    }
    setVerified(true);
    setFactor(null);
    setMessage("TOTP 已驗證；現在可以進入工作人員後台。");
  }

  return (
    <section className="single-step-form">
      <h2>工作人員 TOTP</h2>
      <p>
        手機 OTP 是第一層；後台需要驗證器 App 的
        TOTP。敏感操作仍會要求當下再驗證一次。
      </p>
      {!verified && !factor && (
        <button className="button" onClick={() => void enroll()}>
          開始設定 TOTP
        </button>
      )}
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
              />
            </label>
            <button className="button" type="submit">
              驗證並啟用
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
