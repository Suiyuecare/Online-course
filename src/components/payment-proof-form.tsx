"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type ScanStatus =
  | "idle"
  | "quarantined"
  | "scanning"
  | "safe"
  | "promoted"
  | "rejected"
  | "failed";
type RemoteScanStatus = Exclude<ScanStatus, "idle">;

type Feedback = {
  tone: "info" | "success" | "error";
  text: string;
};

const uploadIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function responseError(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return null;
}

function uploadReference(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("uploadId" in payload.data) ||
    typeof payload.data.uploadId !== "string" ||
    !uploadIdPattern.test(payload.data.uploadId)
  ) {
    return null;
  }
  return payload.data.uploadId;
}

function scanStatus(payload: unknown): RemoteScanStatus | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("status" in payload.data) ||
    typeof payload.data.status !== "string"
  ) {
    return null;
  }
  const status = payload.data.status;
  return [
    "quarantined",
    "scanning",
    "safe",
    "promoted",
    "rejected",
    "failed",
  ].includes(status)
    ? (status as RemoteScanStatus)
    : null;
}

export function PaymentProofForm({
  targetId,
  amountTwd,
  targetType = "order",
}: {
  targetId: string;
  amountTwd: number;
  targetType?: "order" | "topup";
}) {
  const router = useRouter();
  const [message, setMessage] = useState<Feedback | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState("");
  const [currentScanStatus, setCurrentScanStatus] =
    useState<ScanStatus>("idle");
  const [scanMessage, setScanMessage] = useState<Feedback | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileRevision = useRef(0);
  const submissionIdentity = useRef<{
    signature: string;
    idempotencyKey: string;
  } | null>(null);

  function resetAttachment() {
    fileRevision.current += 1;
    setUploadBusy(false);
    setScanBusy(false);
    setSelectedFile(null);
    setUploadId("");
    setCurrentScanStatus("idle");
    setScanMessage(null);
    setFileInputKey((current) => current + 1);
    submissionIdentity.current = null;
  }

  function changeFile(file: File | null) {
    fileRevision.current += 1;
    setUploadBusy(false);
    setScanBusy(false);
    setSelectedFile(file);
    setUploadId("");
    setCurrentScanStatus("idle");
    setScanMessage(
      file
        ? {
            tone: "info",
            text: "尚未上傳。請先按「隔離上傳」，掃描通過後才能連同資料送出。",
          }
        : null,
    );
    submissionIdentity.current = null;
  }

  async function uploadProof() {
    if (!selectedFile || uploadBusy) return;
    const file = selectedFile;
    const revision = fileRevision.current;
    const body = new FormData();
    body.set("purpose", "payment_proof");
    body.set("file", file);
    setUploadBusy(true);
    setUploadId("");
    setCurrentScanStatus("idle");
    setScanMessage({ tone: "info", text: "正在隔離上傳檔案…" });
    try {
      const response = await fetch("/api/uploads/quarantine", {
        method: "POST",
        body,
      });
      const result = await responsePayload(response);
      if (revision !== fileRevision.current) return;
      const nextUploadId = uploadReference(result);
      if (!response.ok || !nextUploadId) {
        const code = responseError(result);
        setScanMessage({
          tone: "error",
          text:
            code === "REQUEST_BODY_TOO_LARGE"
              ? "檔案超過 10 MB，請縮小後重新選擇。"
              : response.status === 401
                ? "登入已失效，請重新登入後再上傳。"
                : "檔案未上傳。請確認為 JPG、PNG 或 PDF 且小於 10 MB，再按一次「隔離上傳」。",
        });
        return;
      }
      setUploadId(nextUploadId);
      setCurrentScanStatus("quarantined");
      setScanMessage({
        tone: "info",
        text: "檔案已隔離，請按「更新掃描狀態」確認是否通過。",
      });
    } catch {
      if (revision !== fileRevision.current) return;
      setScanMessage({
        tone: "error",
        text: "上傳時連線中斷，檔案尚未附加。請按「隔離上傳」重試。",
      });
    } finally {
      if (revision === fileRevision.current) setUploadBusy(false);
    }
  }

  async function refreshScan() {
    if (!uploadId || scanBusy) return;
    const revision = fileRevision.current;
    setScanBusy(true);
    setScanMessage({ tone: "info", text: "正在更新掃描狀態…" });
    try {
      const response = await fetch(
        `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
        { cache: "no-store" },
      );
      const result = await responsePayload(response);
      if (revision !== fileRevision.current) return;
      const status = scanStatus(result);
      if (!response.ok || !status) {
        setScanMessage({
          tone: "error",
          text:
            response.status === 401
              ? "登入已失效，請重新登入後再查詢。"
              : "目前無法取得掃描狀態，檔案尚不能送出。請稍後再按一次「更新掃描狀態」。",
        });
        return;
      }
      setCurrentScanStatus(status);
      const scanLabels: Record<RemoteScanStatus, Feedback> = {
        quarantined: {
          tone: "info",
          text: "檔案已隔離，仍在等待掃描；請稍後再更新。",
        },
        scanning: {
          tone: "info",
          text: "檔案掃描中；完成前不會附加到匯款資料。",
        },
        safe: {
          tone: "info",
          text: "安全掃描已通過，正在建立私有參照；請稍後再更新一次。",
        },
        promoted: {
          tone: "success",
          text: "掃描通過，這份檔案可連同匯款資料送出。",
        },
        rejected: {
          tone: "error",
          text: "檔案未通過掃描，不會供財務讀取。請清除後改選其他檔案。",
        },
        failed: {
          tone: "error",
          text: "掃描服務未能完成，檔案不會被使用。請清除後重新上傳。",
        },
      };
      setScanMessage(scanLabels[status]);
    } catch {
      if (revision !== fileRevision.current) return;
      setScanMessage({
        tone: "error",
        text: "查詢掃描狀態時連線中斷，檔案尚不能送出。請再試一次。",
      });
    } finally {
      if (revision === fileRevision.current) setScanBusy(false);
    }
  }

  async function submit(form: FormData) {
    if (submitBusy || submitted) return;
    const attachmentPending =
      selectedFile !== null && currentScanStatus !== "promoted";
    if (attachmentPending) {
      setMessage({
        tone: "error",
        text: "所選檔案尚未完成掃描。請等掃描通過，或清除檔案後再送出。",
      });
      return;
    }
    const transferredAt = String(form.get("transferredAt"));
    const parsedTransferredAt = new Date(transferredAt);
    if (Number.isNaN(parsedTransferredAt.getTime())) {
      setMessage({ tone: "error", text: "請輸入正確的匯款日期與時間。" });
      return;
    }
    const payload = {
      remitterName: String(form.get("remitterName") ?? ""),
      bankName: String(form.get("bankName") ?? ""),
      accountLastFive: String(form.get("accountLastFive") ?? ""),
      transferredAt: parsedTransferredAt.toISOString(),
      amountTwd: Number(form.get("amountTwd")),
      quarantineId:
        selectedFile && currentScanStatus === "promoted" ? uploadId : null,
    };
    const signature = JSON.stringify(payload);
    if (submissionIdentity.current?.signature !== signature) {
      submissionIdentity.current = {
        signature,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    setSubmitBusy(true);
    setMessage({ tone: "info", text: "正在送出匯款核對資料…" });
    try {
      const response = await fetch(
        targetType === "order"
          ? `/api/orders/${targetId}/proof`
          : `/api/organizations/topups/${targetId}/proof`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": submissionIdentity.current.idempotencyKey,
          },
          body: JSON.stringify(payload),
        },
      );
      const result = await responsePayload(response);
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("ok" in result) ||
        result.ok !== true
      ) {
        const code = responseError(result);
        setMessage({
          tone: "error",
          text:
            response.status === 401
              ? "登入已失效，資料沒有送出。請重新登入後再試。"
              : code === "SAFE_UPLOAD_REQUIRED"
                ? "附件尚未建立安全參照，資料沒有送出。請更新掃描狀態後再試。"
                : response.status >= 500 || result === null
                  ? "服務暫時沒有正確回應，資料是否送達尚未確認。請保留畫面並按同一按鈕重試。"
                  : "資料未送出。請檢查金額、末五碼、匯款時間與訂單期限後重試。",
        });
        return;
      }
      setSubmitted(true);
      setMessage({
        tone: "success",
        text: "核對資料已收到，但尚未付款完成。財務會以銀行實際入帳為準。",
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "送出時連線中斷，是否送達尚未確認。資料仍保留在畫面上，請按同一按鈕重試。",
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  const attachmentPending =
    selectedFile !== null && currentScanStatus !== "promoted";

  return (
    <form
      aria-busy={submitBusy}
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
        <p id={`payment-proof-help-${targetId}`}>
          可選 JPG、PNG 或 PDF，最大 10
          MB。選檔後必須等掃描通過；若不附檔，可直接送出其他核對資料。
        </p>
        <input
          aria-describedby={`payment-proof-help-${targetId} payment-proof-scan-${targetId}`}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          disabled={submitted}
          key={fileInputKey}
          onChange={(event) => changeFile(event.target.files?.[0] ?? null)}
        />
        <button
          className="button secondary"
          type="button"
          onClick={() => void uploadProof()}
          disabled={!selectedFile || uploadBusy || submitted}
        >
          {uploadBusy ? "上傳中…" : "隔離上傳"}
        </button>
        {uploadId && (
          <button
            className="button secondary"
            type="button"
            onClick={() => void refreshScan()}
            disabled={scanBusy || uploadBusy || submitted}
          >
            {scanBusy ? "查詢中…" : "更新掃描狀態"}
          </button>
        )}
        {selectedFile && (
          <button
            className="button secondary"
            disabled={submitBusy || submitted}
            type="button"
            onClick={resetAttachment}
          >
            清除附件
          </button>
        )}
        <input
          name="quarantineId"
          type="hidden"
          value={currentScanStatus === "promoted" ? uploadId : ""}
        />
        <p
          id={`payment-proof-scan-${targetId}`}
          aria-live={scanMessage?.tone === "error" ? "assertive" : "polite"}
          className={
            scanMessage?.tone === "error"
              ? "flow-message flow-message-error"
              : "flow-message"
          }
          role={scanMessage?.tone === "error" ? "alert" : "status"}
        >
          {scanMessage?.text}
        </p>
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
      <button
        className="button"
        disabled={submitBusy || submitted || attachmentPending}
        type="submit"
      >
        {submitBusy
          ? "送出中…"
          : submitted
            ? "資料已送出"
            : attachmentPending
              ? "等待附件掃描通過"
              : "送出供財務核對"}
      </button>
      <p
        aria-live={message?.tone === "error" ? "assertive" : "polite"}
        className={
          message?.tone === "error"
            ? "flow-message flow-message-error"
            : "flow-message"
        }
        role={message?.tone === "error" ? "alert" : "status"}
      >
        {message?.text}
      </p>
    </form>
  );
}
