"use client";

import { useState } from "react";
import { presentErrorCode } from "@/domain/presentation";

type BankRow = {
  localId: string;
  remitterName: string;
  accountLastFive: string;
  amountTwd: string;
  bankReference: string;
};

function emptyRow(localId = crypto.randomUUID()): BankRow {
  return {
    localId,
    remitterName: "",
    accountLastFive: "",
    amountTwd: "",
    bankReference: "",
  };
}

async function waitForSafeScan(uploadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" },
    );
    const result = await response.json().catch(() => null);
    const status = result?.data?.status;
    if (status === "promoted") return;
    if (["rejected", "failed"].includes(status)) {
      throw new Error("BANK_STATEMENT_SCAN_REJECTED");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("BANK_STATEMENT_SCAN_PENDING");
}

export function FinanceBankImportPanel() {
  const [rows, setRows] = useState<BankRow[]>([emptyRow("initial")]);
  const [pasteRows, setPasteRows] = useState("");
  const [message, setMessage] = useState(
    "先附上銀行原始明細，再逐筆確認匯款人、末五碼、金額與銀行序號。",
  );
  const [busy, setBusy] = useState(false);

  function updateRow(
    localId: string,
    key: Exclude<keyof BankRow, "localId">,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.localId === localId ? { ...row, [key]: value } : row,
      ),
    );
  }

  function parsePastedRows() {
    const parsed = pasteRows
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [remitterName, accountLastFive, amountTwd, bankReference] = line
          .split(/[\t,]/)
          .map((part) => part.trim());
        return {
          localId: crypto.randomUUID(),
          remitterName: remitterName ?? "",
          accountLastFive: accountLastFive ?? "",
          amountTwd: (amountTwd ?? "").replace(/[,，]/g, ""),
          bankReference: bankReference ?? "",
        };
      });
    if (parsed.length === 0 || parsed.length > 5000) {
      setMessage("貼上的明細必須是 1 至 5,000 列。");
      return;
    }
    setRows(parsed);
    setMessage(`已帶入 ${parsed.length} 列；送出前請逐筆核對。`);
  }

  return (
    <section className="single-step-form">
      <h2>匯入銀行原始明細</h2>
      <p>
        匯入者不能自行完成覆核。原始檔先進隔離掃描，交易列會重新產生防竄改指紋；另一位財務人員須在上方案件佇列完成
        fresh TOTP 覆核。
      </p>
      <label>
        快速貼上（每列依序為：匯款人、帳號末五碼、金額、銀行序號）
        <textarea
          value={pasteRows}
          onChange={(event) => setPasteRows(event.target.value)}
          placeholder={"王小明,12345,1000,TXN-001\n陳美華,,2000,TXN-002"}
        />
      </label>
      <button
        className="button secondary"
        onClick={parsePastedRows}
        type="button"
      >
        帶入下方欄位
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const source = form.get("statement");
          if (!(source instanceof File) || source.size === 0) {
            setMessage("請選擇銀行原始明細檔。");
            return;
          }
          const normalized = rows.map((row) => ({
            remitterName: row.remitterName.trim(),
            accountLastFive: row.accountLastFive.trim() || null,
            amountTwd: Number(row.amountTwd),
            bankReference: row.bankReference.trim(),
          }));
          if (
            normalized.some(
              (row) =>
                !row.remitterName ||
                (row.accountLastFive !== null &&
                  !/^\d{5}$/.test(row.accountLastFive)) ||
                !Number.isSafeInteger(row.amountTwd) ||
                row.amountTwd <= 0 ||
                !row.bankReference,
            )
          ) {
            setMessage("明細有缺漏：末五碼若填寫須為 5 位數，金額須為正整數。");
            return;
          }

          setBusy(true);
          setMessage("原始檔隔離掃描中，請保留此頁…");
          const upload = new FormData();
          upload.set("purpose", "bank_statement");
          upload.set("file", source);
          void fetch("/api/uploads/quarantine", {
            method: "POST",
            body: upload,
          })
            .then(async (response) => {
              const result = await response.json().catch(() => null);
              if (!response.ok || !result?.data?.uploadId) {
                throw new Error(
                  result?.error ?? "BANK_STATEMENT_UPLOAD_REJECTED",
                );
              }
              await waitForSafeScan(result.data.uploadId);
              return result.data.uploadId as string;
            })
            .then(async (quarantineId) => {
              setMessage("掃描通過，正在建立不可竄改的交易批次…");
              const response = await fetch("/api/staff/finance/bank-imports", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": crypto.randomUUID(),
                },
                body: JSON.stringify({
                  quarantineId,
                  bookedOn: form.get("bookedOn"),
                  rows: normalized,
                }),
              });
              const result = await response.json().catch(() => null);
              if (!response.ok) {
                throw new Error(result?.error ?? "BANK_IMPORT_REJECTED");
              }
            })
            .then(() => {
              setMessage(
                "批次已建立；必須由不同的財務人員在案件佇列覆核後才會生效。",
              );
              window.setTimeout(() => window.location.reload(), 1200);
            })
            .catch((error: Error) =>
              setMessage(
                presentErrorCode(
                  error.message,
                  "銀行批次未建立；請檢查檔案掃描、欄位與權限。",
                ),
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          入帳日期
          <input name="bookedOn" type="date" required />
        </label>
        <label>
          銀行原始明細（CSV、XLSX、PDF，10 MB 內）
          <input
            name="statement"
            type="file"
            accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
        </label>
        <div className="record-list">
          {rows.map((row, index) => (
            <fieldset key={row.localId}>
              <legend>第 {index + 1} 筆</legend>
              <label>
                匯款人
                <input
                  value={row.remitterName}
                  onChange={(event) =>
                    updateRow(row.localId, "remitterName", event.target.value)
                  }
                  maxLength={100}
                  required
                />
              </label>
              <label>
                帳號末五碼（銀行未提供可留空）
                <input
                  value={row.accountLastFive}
                  onChange={(event) =>
                    updateRow(
                      row.localId,
                      "accountLastFive",
                      event.target.value.replace(/\D/g, "").slice(0, 5),
                    )
                  }
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                />
              </label>
              <label>
                金額（NT$）
                <input
                  value={row.amountTwd}
                  onChange={(event) =>
                    updateRow(row.localId, "amountTwd", event.target.value)
                  }
                  type="number"
                  min={1}
                  step={1}
                  required
                />
              </label>
              <label>
                銀行交易序號
                <input
                  value={row.bankReference}
                  onChange={(event) =>
                    updateRow(row.localId, "bankReference", event.target.value)
                  }
                  maxLength={200}
                  required
                />
              </label>
              {rows.length > 1 && (
                <button
                  className="button secondary"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.localId !== row.localId),
                    )
                  }
                  type="button"
                >
                  移除此筆
                </button>
              )}
            </fieldset>
          ))}
        </div>
        <button
          className="button secondary"
          onClick={() => setRows((current) => [...current, emptyRow()])}
          type="button"
        >
          新增一筆
        </button>
        <button className="button" disabled={busy} type="submit">
          {busy ? "處理中…" : "隔離掃描並建立批次"}
        </button>
      </form>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
