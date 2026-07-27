"use client";

import { useState } from "react";

export function InvitationAccept({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="single-step-form">
      <h1>接受機構邀請</h1>
      <p>請先用收到邀請的同一支手機完成 OTP 登入。</p>
      <button
        className="button"
        onClick={async () => {
          const response = await fetch(
            "/api/organizations/invitations/accept",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              },
              body: JSON.stringify({ token }),
            },
          );
          setMessage(
            response.ok
              ? "已加入機構，可回到機構工作台。"
              : "邀請無效、已過期、已撤銷，或登入手機不相同。",
          );
        }}
      >
        驗證手機並接受
      </button>
      <p aria-live="polite">{message}</p>
    </div>
  );
}
