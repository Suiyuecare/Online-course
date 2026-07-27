"use client";

import { useState } from "react";

export function AccreditationIdentityForm({
  enrollmentId,
}: {
  enrollmentId: string;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        void fetch("/api/profile/accreditation", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            enrollmentId,
            realName: form.get("realName"),
            nationalId: form.get("nationalId"),
            birthDate: form.get("birthDate"),
            careWorkerId: form.get("careWorkerId"),
            personnelCategory: form.get("personnelCategory"),
            serviceUnit: form.get("serviceUnit"),
          }),
        })
          .then((response) => {
            if (!response.ok) throw new Error("REJECTED");
            setMessage(
              "積分身分資料已加密送出。每次報名仍需再次確認；審核完成前不會核發積分證明。",
            );
          })
          .catch(() => setMessage("資料尚未送出，請檢查欄位或稍後再試。"))
          .finally(() => setSubmitting(false));
      }}
    >
      <h2>積分身分資料</h2>
      <p>
        第一次參加積分課程請填寫。敏感資料由伺服器加密，頁面不會重新顯示完整內容。
      </p>
      <label>
        真實姓名
        <input name="realName" autoComplete="name" maxLength={80} required />
      </label>
      <label>
        身分證或居留證號
        <input
          name="nationalId"
          autoComplete="off"
          pattern="[A-Za-z0-9]{8,20}"
          maxLength={20}
          required
        />
      </label>
      <label>
        出生日期
        <input name="birthDate" type="date" required />
      </label>
      <label>
        長照人員認證字號
        <input
          name="careWorkerId"
          autoComplete="off"
          pattern="[A-Za-z0-9-]{4,40}"
          maxLength={40}
          required
        />
      </label>
      <label>
        人員類別
        <input name="personnelCategory" maxLength={80} required />
      </label>
      <label>
        服務單位
        <input name="serviceUnit" maxLength={200} required />
      </label>
      <button className="button" type="submit" disabled={submitting}>
        {submitting ? "加密送出中…" : "確認並加密送出"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
