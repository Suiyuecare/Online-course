"use client";

import { useState } from "react";

export function PaymentProofForm({
  targetId,
  amountTwd,
  targetType = "order",
}: {
  targetId: string;
  amountTwd: number;
  targetType?: "order" | "topup";
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState("");
  const [scanMessage, setScanMessage] = useState("");

  async function uploadProof() {
    if (!selectedFile) return;
    const body = new FormData();
    body.set("purpose", "payment_proof");
    body.set("file", selectedFile);
    const response = await fetch("/api/uploads/quarantine", {
      method: "POST",
      body,
    });
    const result = await response.json();
    if (!response.ok) {
      setScanMessage("檔案格式、大小或 magic bytes 不符，未上傳。");
      return;
    }
    setUploadId(result.data.uploadId);
    setScanMessage("檔案已隔離，等待惡意程式與 metadata 掃描。");
  }

  async function refreshScan() {
    if (!uploadId) return;
    const response = await fetch(
      `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    const status = result.data?.status;
    const scanLabels: Record<string, string> = {
      quarantined: "檔案已隔離，等待掃描。",
      scanning: "檔案掃描中。",
      safe: "掃描已通過，等待建立私有參照。",
      failed: "掃描服務失敗，檔案不會被使用。",
    };
    setScanMessage(
      status === "promoted"
        ? "掃描通過，可連同匯款資料送出。"
        : status === "rejected"
          ? "檔案未通過掃描，不會供財務讀取。"
          : (scanLabels[status] ?? "目前無法確認掃描狀態。"),
    );
  }

  async function submit(form: FormData) {
    setBusy(true);
    const transferredAt = String(form.get("transferredAt"));
    const response = await fetch(
      targetType === "order"
        ? `/api/orders/${targetId}/proof`
        : `/api/organizations/topups/${targetId}/proof`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          remitterName: form.get("remitterName"),
          bankName: form.get("bankName"),
          accountLastFive: form.get("accountLastFive"),
          transferredAt: new Date(transferredAt).toISOString(),
          amountTwd: Number(form.get("amountTwd")),
          quarantineId: String(form.get("quarantineId") ?? "").trim() || null,
        }),
      },
    );
    setBusy(false);
    setMessage(
      response.ok
        ? "核對資料已收到，但尚未付款完成。財務會以銀行實際入帳為準。"
        : "資料未送出。請檢查金額、末五碼、時間與訂單期限。",
    );
  }

  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
    >
      <h2>提交匯款核對資料</h2>
      <label>
        匯款人姓名
        <input name="remitterName" required maxLength={100} />
      </label>
      <label>
        匯出銀行
        <input name="bankName" required maxLength={100} />
      </label>
      <label>
        匯出帳號末五碼
        <input
          inputMode="numeric"
          name="accountLastFive"
          pattern="[0-9]{5}"
          required
        />
      </label>
      <label>
        匯款時間
        <input name="transferredAt" type="datetime-local" required />
      </label>
      <fieldset>
        <legend>匯款證明檔（選填）</legend>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        <button
          className="button secondary"
          type="button"
          onClick={() => void uploadProof()}
        >
          隔離上傳
        </button>
        {uploadId && (
          <button
            className="button secondary"
            type="button"
            onClick={() => void refreshScan()}
          >
            更新掃描狀態
          </button>
        )}
        <input name="quarantineId" type="hidden" value={uploadId} />
        <p aria-live="polite">{scanMessage}</p>
      </fieldset>
      <label>
        匯款金額
        <input
          inputMode="numeric"
          name="amountTwd"
          type="number"
          min={1}
          defaultValue={amountTwd}
          required
        />
      </label>
      <button className="button" disabled={busy} type="submit">
        {busy ? "送出中…" : "送出供財務核對"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
