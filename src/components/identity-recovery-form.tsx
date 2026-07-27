"use client";

import { useState } from "react";

async function waitForPromotion(uploadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (result.data?.status === "promoted") return;
    if (["rejected", "failed"].includes(result.data?.status)) {
      throw new Error("EVIDENCE_REJECTED");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("EVIDENCE_SCAN_PENDING");
}

export function IdentityRecoveryForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        const form = new FormData(event.currentTarget);
        const upload = new FormData();
        upload.set("purpose", "identity_correction");
        upload.set("file", form.get("evidence")!);
        void fetch("/api/uploads/quarantine", {
          method: "POST",
          body: upload,
        })
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok || !result.data?.uploadId) {
              throw new Error("UPLOAD_REJECTED");
            }
            await waitForPromotion(result.data.uploadId);
            return result.data.uploadId as string;
          })
          .then((uploadId) =>
            fetch("/api/profile/recovery", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              },
              body: JSON.stringify({
                kind: form.get("kind"),
                evidenceSummary: form.get("evidenceSummary"),
                uploadId,
              }),
            }),
          )
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error("REQUEST_REJECTED");
            setMessage(
              `復原案件 ${result.data.recoveryCaseId} 已提出。兩位不同管理員核准與 24 小時冷卻完成前，舊資料持續封鎖。`,
            );
          })
          .catch(() =>
            setMessage(
              "證據尚未通過隔離掃描或案件未建立；請保留案件資料並聯絡客服。",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2>高保證帳號復原</h2>
      <p>
        手機 OTP
        不等於舊帳號所有權。歲悅會比對既有加密身分、付款或證明資料；客服不能略過雙人核准。
      </p>
      <label>
        復原類型
        <select name="kind">
          <option value="recycled_number">疑似回收門號／新裝置</option>
          <option value="lost_phone">舊手機遺失</option>
          <option value="totp_recovery">工作人員 TOTP 復原</option>
        </select>
      </label>
      <label>
        可與舊資料交叉核對的說明（請勿上傳病歷或個案資料）
        <textarea name="evidenceSummary" minLength={20} required />
      </label>
      <label>
        必要證據（PDF／JPG／PNG，先隔離掃描）
        <input
          name="evidence"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          required
        />
      </label>
      <button className="button" disabled={busy} type="submit">
        {busy ? "掃描與建立案件中…" : "送出復原案件"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
