"use client";

import { createBrowserClient } from "@supabase/ssr";

function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
  return createBrowserClient(url, key);
}

export async function verifyFreshTotp() {
  const supabase = browserSupabase();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((item) => item.status === "verified");
  if (!factor) throw new Error("TOTP_NOT_ENROLLED");
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError) throw challengeError;
  const code = window.prompt("請輸入驗證器 App 的六位數 TOTP");
  if (!code || !/^\d{6}$/.test(code)) throw new Error("TOTP_REQUIRED");
  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });
  if (error) throw error;
}

export async function obtainStepUp(action: string, target: string) {
  await verifyFreshTotp();
  const response = await fetch("/api/staff/step-up", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ action, target }),
  });
  const result = await response.json();
  if (!response.ok || !result.data?.nonce) {
    throw new Error("STEP_UP_REJECTED");
  }
  return result.data.nonce as string;
}

export function staffBrowserSupabase() {
  return browserSupabase();
}
