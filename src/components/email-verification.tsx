"use client";

import { useState } from "react";

async function send(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("REQUEST_REJECTED");
  return response.json();
}

export function EmailVerification() {
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="single-step-form">
      <h2>先驗證機構聯絡 Email</h2>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {!requested ? (
        <button
          className="button secondary"
          onClick={() =>
            void send("/api/profile/email/request", { email })
              .then(() => {
                setRequested(true);
                setMessage("驗證碼已寄出，10 分鐘內有效。");
              })
              .catch(() => setMessage("目前無法寄送；請稍後再試。"))
          }
        >
          寄出六位數驗證碼
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get("code"));
            void send("/api/profile/email/verify", { email, code })
              .then(() => setMessage("Email 已驗證，可以提交機構申請。"))
              .catch(() => setMessage("驗證碼錯誤、過期或嘗試次數已達上限。"));
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
            完成驗證
          </button>
        </form>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}
