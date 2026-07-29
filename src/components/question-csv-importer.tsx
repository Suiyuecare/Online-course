"use client";

import { useMemo, useState } from "react";
import {
  parseQuestionCsv,
  questionCsvTemplate,
  type QuestionImportPreview,
} from "@/application/question-csv";
import { presentErrorCode } from "@/domain/presentation";

async function importQuestions(courseVersionId: string, questions: unknown) {
  const response = await fetch(
    `/api/staff/courses/${encodeURIComponent(courseVersionId)}/questions/import`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ questions }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(result?.error ?? "QUESTION_IMPORT_REJECTED");
  return result?.data;
}

function downloadTemplate() {
  const blob = new Blob(["\uFEFF", questionCsvTemplate()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "歲悅學苑題庫匯入範本.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function QuestionCsvImporter({
  courseVersionId,
}: {
  courseVersionId: string;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<QuestionImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "先預覽並修正所有列；整批驗證通過後才會一次寫入，不會只匯入一半。",
  );
  const importReady = Boolean(
    preview && preview.questions.length > 0 && preview.errors.length === 0,
  );
  const previewRows = useMemo(
    () => preview?.questions.slice(0, 20) ?? [],
    [preview],
  );

  function refreshPreview(value = csv) {
    const parsed = parseQuestionCsv(value);
    setPreview(parsed);
    setMessage(
      parsed.errors.length > 0
        ? `發現 ${parsed.errors.length} 個問題，請先修正。`
        : `共 ${parsed.questions.length} 題可匯入${
            parsed.sanitizedCells > 0
              ? `；已安全處理 ${parsed.sanitizedCells} 個公式開頭儲存格`
              : ""
          }。`,
    );
  }

  return (
    <section className="single-step-form question-csv-importer">
      <div className="question-import-heading">
        <div>
          <p className="eyebrow">大量建題</p>
          <h2>CSV 批次匯入題庫</h2>
        </div>
        <button
          className="button secondary"
          onClick={downloadTemplate}
          type="button"
        >
          下載 CSV 範本
        </button>
      </div>
      <p className="closed-note">
        支援 Excel 另存的 UTF-8 CSV，正確答案可填 1–4 或
        A–D。為避免日後匯出時執行試算表公式，以 =、+、-、@
        開頭的文字會自動轉為純文字。
      </p>
      <label>
        選擇 CSV（1 MB、200 題內）
        <input
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              setCsv("");
              setPreview({
                questions: [],
                errors: [{ row: 0, message: "CSV 不可超過 1 MB。" }],
                sanitizedCells: 0,
              });
              return;
            }
            void file.text().then((value) => {
              setCsv(value);
              refreshPreview(value);
            });
          }}
          type="file"
        />
      </label>
      <label>
        或貼上 CSV 內容
        <textarea
          maxLength={1_000_000}
          onChange={(event) => {
            setCsv(event.target.value);
            setPreview(null);
          }}
          placeholder={questionCsvTemplate()}
          rows={9}
          value={csv}
        />
      </label>
      <div className="question-import-actions">
        <button
          className="button secondary"
          disabled={busy || !csv.trim()}
          onClick={() => refreshPreview()}
          type="button"
        >
          預覽並檢查
        </button>
        <button
          className="button"
          disabled={busy || !importReady}
          onClick={() => {
            if (!preview || !importReady) return;
            setBusy(true);
            setMessage("正在整批寫入題庫…");
            void importQuestions(courseVersionId, preview.questions)
              .then((result) => {
                const imported =
                  result &&
                  typeof result === "object" &&
                  "importedCount" in result &&
                  typeof result.importedCount === "number"
                    ? result.importedCount
                    : preview.questions.length;
                setMessage(`已完整匯入 ${imported} 題，正在重新載入題庫。`);
                window.setTimeout(() => window.location.reload(), 600);
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "整批未匯入；既有題庫保持不變，請重新檢查。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
          type="button"
        >
          {busy ? "匯入中…" : "確認整批匯入"}
        </button>
      </div>

      {preview ? (
        <div className="question-import-preview">
          <p aria-live="polite" className="form-message">
            {message}
          </p>
          {preview.errors.length > 0 ? (
            <div className="warning-panel">
              <strong>尚未寫入，請修正下列內容</strong>
              <ul>
                {preview.errors.slice(0, 30).map((error) => (
                  <li key={`${error.row}:${error.message}`}>
                    {error.row > 0 ? `第 ${error.row} 列：` : ""}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="question-import-table-wrap">
              <table>
                <caption>
                  匯入預覽（顯示前 {previewRows.length} 題，共{" "}
                  {preview.questions.length} 題）
                </caption>
                <thead>
                  <tr>
                    <th scope="col">序號</th>
                    <th scope="col">主題</th>
                    <th scope="col">題目</th>
                    <th scope="col">正解</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((question, index) => (
                    <tr key={`${question.topic}:${question.prompt}`}>
                      <td>{index + 1}</td>
                      <td>{question.topic}</td>
                      <td>{question.prompt}</td>
                      <td>{question.correctIndex + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p aria-live="polite" className="form-message">
          {message}
        </p>
      )}
    </section>
  );
}
