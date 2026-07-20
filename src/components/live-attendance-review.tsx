"use client";

import { useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  MoveRight,
  ShieldAlert,
} from "lucide-react";

export type ReviewRow = {
  bookingId: string;
  learnerName: string;
  bookingStatus: string;
  registrationStatus: string;
  checkedIn: boolean;
  checkedOut: boolean;
  cameraPercent: number;
  attendanceStatus: string;
  reasons: string[];
};
export type TransferTarget = {
  id: string;
  title: string;
  startsAt: string;
  remaining: number;
};

export function LiveAttendanceReview({
  sessionId,
  rows,
  targets,
  editable,
}: {
  sessionId: string;
  rows: ReviewRow[];
  targets: TransferTarget[];
  editable: boolean;
}) {
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState(
    editable ? "" : "客服可查看狀態，但不能補正或轉班。",
  );
  async function review(formData: FormData) {
    const bookingId = String(formData.get("bookingId"));
    setBusyId(bookingId);
    setMessage("");
    const response = await fetch(
      `/api/admin/live-sessions/${sessionId}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingId,
          decision: formData.get("decision"),
          reason: formData.get("reason"),
          cameraSecondsDelta: Number(formData.get("cameraSecondsDelta") || 0),
          checkInOverride: formData.get("checkInOverride") === "on",
          checkOutOverride: formData.get("checkOutOverride") === "on",
        }),
      },
    );
    const result = await response.json();
    setBusyId("");
    setMessage(
      response.ok
        ? "覆核已追加保存，原始 Zoom 與鏡頭事件未被修改。"
        : (result.message ?? "覆核失敗。"),
    );
    if (response.ok) window.location.reload();
  }
  async function transfer(formData: FormData) {
    const bookingId = String(formData.get("bookingId"));
    setBusyId(bookingId);
    setMessage("");
    const response = await fetch(
      `/api/admin/live-sessions/${sessionId}/transfer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingId,
          targetSessionId: formData.get("targetSessionId"),
          reason: formData.get("transferReason"),
        }),
      },
    );
    const result = await response.json();
    setBusyId("");
    setMessage(
      response.ok
        ? "轉班完成，新場次已產生獨立席次與出席摘要。"
        : (result.message ?? "轉班失敗。"),
    );
    if (response.ok) window.location.reload();
  }
  return (
    <div className="space-y-5">
      {rows.map((row) => (
        <article key={row.bookingId} className="panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-[#302318]">
                  {row.learnerName}
                </h2>
                <Badge text={row.bookingStatus} />
                <Badge text={`積分資料 ${row.registrationStatus}`} />
                <Badge text={`出席 ${row.attendanceStatus}`} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Status
                  label="簽到"
                  value={row.checkedIn ? "完成" : "未完成"}
                />
                <Status
                  label="簽退"
                  value={row.checkedOut ? "完成" : "未完成"}
                />
                <Status
                  label="鏡頭比例"
                  value={`${row.cameraPercent.toFixed(1)}%`}
                />
                <Status
                  label="異常原因"
                  value={row.reasons.join("、") || "無"}
                />
              </dl>
            </div>
            <span
              className={`grid size-11 place-items-center rounded-xl ${row.attendanceStatus === "qualified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
            >
              {row.attendanceStatus === "qualified" ? (
                <CheckCircle2 />
              ) : (
                <ShieldAlert />
              )}
            </span>
          </div>
          {editable && (
            <div className="mt-5 grid gap-4 border-t border-[#EADFCF] pt-5 xl:grid-cols-2">
              <form action={review} className="rounded-xl bg-[#FFF8ED] p-4">
                <input type="hidden" name="bookingId" value={row.bookingId} />
                <p className="text-sm font-black text-[#694115]">
                  出席覆核（append-only）
                </p>
                <div className="mt-3 grid gap-3">
                  <select
                    name="decision"
                    className="field"
                    defaultValue="manual_correction"
                  >
                    <option value="manual_correction">人工補正</option>
                    <option value="maintain_disqualified">維持不合格</option>
                  </select>
                  <input
                    name="cameraSecondsDelta"
                    className="field"
                    type="number"
                    defaultValue="0"
                    placeholder="鏡頭秒數調整"
                  />
                  <label className="text-sm font-bold">
                    <input type="checkbox" name="checkInOverride" /> 補正簽到
                  </label>
                  <label className="text-sm font-bold">
                    <input type="checkbox" name="checkOutOverride" /> 補正簽退
                  </label>
                  <textarea
                    name="reason"
                    className="field min-h-24"
                    required
                    minLength={5}
                    placeholder="必填：補正依據與原因"
                  />
                  <button
                    disabled={busyId === row.bookingId}
                    className="button-primary min-h-11"
                  >
                    {busyId === row.bookingId && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    儲存覆核
                  </button>
                </div>
              </form>
              <form action={transfer} className="rounded-xl bg-slate-50 p-4">
                <input type="hidden" name="bookingId" value={row.bookingId} />
                <p className="text-sm font-black text-slate-700">人工轉班</p>
                <div className="mt-3 grid gap-3">
                  <select name="targetSessionId" className="field" required>
                    <option value="">選擇同課程未來場次</option>
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.title}・剩 {target.remaining} 席
                      </option>
                    ))}
                  </select>
                  <textarea
                    name="transferReason"
                    className="field min-h-24"
                    required
                    minLength={5}
                    placeholder="必填：轉班原因"
                  />
                  <button
                    disabled={busyId === row.bookingId || targets.length === 0}
                    className="button-secondary min-h-11"
                  >
                    <MoveRight className="size-4" />
                    轉到新場次
                  </button>
                </div>
              </form>
            </div>
          )}
        </article>
      ))}
      {rows.length === 0 && (
        <div className="panel p-8 text-center text-sm font-bold text-slate-500">
          此場次尚無已付款或已取消的學員。
        </div>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900"
        >
          {message}
        </p>
      )}
    </div>
  );
}
function Badge({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
      {text}
    </span>
  );
}
function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-black text-[#302318]">{value}</dd>
    </div>
  );
}
