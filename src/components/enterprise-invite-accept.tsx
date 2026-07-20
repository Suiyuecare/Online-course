"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";

export function EnterpriseInviteAccept({
  token,
  signedIn,
}: {
  token: string;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  if (!signedIn)
    return (
      <Link
        className="button-primary mt-6"
        href={`/login?next=${encodeURIComponent(`/enterprise/invite/${token}`)}`}
      >
        使用受邀 Email 登入
      </Link>
    );
  async function accept() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/enterprise/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(
          result?.error === "EMAIL_MISMATCH"
            ? "目前登入的 Email 與受邀 Email 不同。"
            : "邀請已過期、被撤銷或無法接受，請聯絡機構管理者。",
        );
        return;
      }
      setAccepted(true);
    } catch {
      setMessage("網路連線失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }
  return accepted ? (
    <div className="mt-6">
      <p className="flex items-center justify-center gap-2 font-black text-emerald-700">
        <CheckCircle2 /> 已加入機構
      </p>
      <Link className="button-primary mt-5" href="/dashboard">
        前往我的學習
      </Link>
    </div>
  ) : (
    <div className="mt-6">
      <button
        type="button"
        className="button-primary min-h-11"
        disabled={busy}
        onClick={accept}
      >
        {busy && <LoaderCircle className="size-4 animate-spin" />}
        接受邀請
      </button>
      {message && (
        <p role="alert" className="mt-4 text-sm font-bold text-rose-700">
          {message}
        </p>
      )}
    </div>
  );
}
