"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  FileWarning,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

export type AccreditationReviewRow = {
  id: string;
  learner: string;
  course: string;
  maskedId: string;
  category: string;
  status: string;
  progress: number;
  quizPassed: boolean;
  satisfactionCompleted: boolean;
  reasons: string[];
};

export function AccreditationReviewTable({
  rows: initialRows,
  enabled,
  courseId,
}: {
  rows: AccreditationReviewRow[];
  enabled: boolean;
  courseId: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  async function review(id: string, status: "verified" | "needs_correction") {
    const reason =
      status === "needs_correction"
        ? window.prompt("請輸入學員需要補正的原因")?.trim()
        : "";
    if (status === "needs_correction" && !reason) return;
    setBusyId(id);
    setMessage("");
    const response = await fetch(`/api/admin/accreditation/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, reason }),
    });
    const data = await response.json();
    setBusyId("");
    if (!response.ok) return setMessage("審核結果儲存失敗。");
    setRows((value) =>
      value.map((row) =>
        row.id === id
          ? {
              ...row,
              status,
              reasons:
                status === "verified"
                  ? row.reasons.filter((item) => !item.includes("身分資料"))
                  : [reason!, ...row.reasons],
            }
          : row,
      ),
    );
    setMessage(
      status === "verified"
        ? data.completion?.verificationCode
          ? "資料已驗證，正式證明已產生。"
          : "資料已驗證；其餘完課條件完成後才會發證。"
        : "已通知為需要補正。",
    );
  }
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[#EADFCF] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-[#302318]">積分資格與異常</h2>
          <p className="mt-1 text-sm text-slate-500">
            客服只看遮罩；驗證與匯出限管理員。
          </p>
        </div>
        {courseId ? (
          <a
            className="button-secondary"
            href={`/api/exports/accreditation?courseId=${encodeURIComponent(courseId)}`}
          >
            <Download className="size-4" />
            匯出此課送審 Excel
          </a>
        ) : (
          <span className="text-sm font-bold text-slate-400">選課後可匯出</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="data-table min-w-[980px]">
          <thead>
            <tr>
              <th>學員</th>
              <th>課程</th>
              <th>身分遮罩</th>
              <th>進度</th>
              <th>測驗</th>
              <th>資料狀態</th>
              <th>異常原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-black">
                  {row.learner}
                  <span className="mt-1 block text-xs font-medium text-slate-400">
                    {row.category}
                  </span>
                </td>
                <td>{row.course}</td>
                <td className="font-mono">{row.maskedId}</td>
                <td>{row.progress}%</td>
                <td>{row.quizPassed ? "通過" : "未通過"}</td>
                <td>
                  <Status status={row.status} />
                </td>
                <td>
                  {row.reasons.length ? (
                    <span className="inline-flex items-start gap-1.5 text-rose-700">
                      <FileWarning className="mt-0.5 size-4 shrink-0" />
                      {row.reasons.join("、")}
                    </span>
                  ) : (
                    <span className="text-emerald-700">條件齊全</span>
                  )}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button
                      disabled={!enabled || busyId === row.id}
                      onClick={() => review(row.id, "verified")}
                      className="button-primary min-h-10 px-3 py-2 text-xs"
                    >
                      {busyId === row.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      驗證
                    </button>
                    <button
                      disabled={!enabled || busyId === row.id}
                      onClick={() => review(row.id, "needs_correction")}
                      className="button-secondary min-h-10 px-3 py-2 text-xs"
                    >
                      <RotateCcw className="size-4" />
                      補正
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-8 text-center text-sm font-bold text-slate-500">
            目前還沒有積分報名資料。
          </p>
        )}
      </div>
      {message && (
        <p
          role="status"
          className="m-5 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold text-[#694115]"
        >
          {message}
        </p>
      )}
    </section>
  );
}

function Status({ status }: { status: string }) {
  const text =
    status === "verified"
      ? "已驗證"
      : status === "needs_correction"
        ? "待補正"
        : status === "rejected"
          ? "不通過"
          : "待審核";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-black ${status === "verified" ? "bg-emerald-100 text-emerald-700" : status === "needs_correction" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}
    >
      {text}
    </span>
  );
}
