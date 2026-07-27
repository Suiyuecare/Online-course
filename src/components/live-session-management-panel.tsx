"use client";

import { useState } from "react";
import {
  BreakIntervalEditor,
  type DraftBreak,
  toBreakPayload,
} from "@/components/live-staff-panel";
import { presentErrorCode } from "@/domain/presentation";

function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "REQUEST_REJECTED");
  return result?.data;
}

export function LiveSessionManagementPanel({
  liveSessionId,
  initialBreaks,
  startsAt,
  endsAt,
  bookingCloseAt,
  canEditBreaks,
  canSettle,
  canReschedule,
}: {
  liveSessionId: string;
  initialBreaks: Array<{ startsAt: string; endsAt: string }>;
  startsAt: string;
  endsAt: string;
  bookingCloseAt: string;
  canEditBreaks: boolean;
  canSettle: boolean;
  canReschedule: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleAction, setScheduleAction] = useState<"reschedule" | "cancel">(
    "reschedule",
  );
  const [breaks, setBreaks] = useState<DraftBreak[]>(
    initialBreaks.map((interval, index) => ({
      id: index + 1,
      startsAt: localDateTime(interval.startsAt),
      endsAt: localDateTime(interval.endsAt),
    })),
  );

  function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("處理中…");
    void operation()
      .then(() => setMessage(success))
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(error.message, "操作未完成；請確認案件狀態與權限。"),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      {canEditBreaks && (
        <form
          className="single-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(
              () =>
                post(`/api/staff/live/${liveSessionId}/breaks`, {
                  breakIntervals: toBreakPayload(breaks),
                  reason: form.get("reason"),
                }),
              "草稿場次的正式休息區段已更新。",
            );
          }}
        >
          <h2>修改正式休息</h2>
          <p>只有未鎖定的草稿可改；各區段必須在本場教學時間內且不可重疊。</p>
          <BreakIntervalEditor intervals={breaks} onChange={setBreaks} />
          <label>
            修改理由
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            儲存休息區段
          </button>
        </form>
      )}

      {canSettle && (
        <section className="single-step-form">
          <h2>結算出席</h2>
          <p>
            場次結束滿 24 小時且證據完整後，系統才會依
            Zoom、學員端與簽到紀錄鎖定結果。
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              run(
                () => post(`/api/staff/live/${liveSessionId}/settle`, {}),
                "出席證據已鎖定並完成結算。",
              )
            }
            type="button"
          >
            依原始證據結算
          </button>
        </section>
      )}

      {canReschedule && (
        <form
          className="single-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const optionalIso = (name: string) => {
              const value = String(form.get(name) ?? "").trim();
              return value ? new Date(value).toISOString() : null;
            };
            run(
              () =>
                post(`/api/staff/live/${liveSessionId}/schedule`, {
                  action: scheduleAction,
                  startsAt: optionalIso("startsAt"),
                  endsAt: optionalIso("endsAt"),
                  bookingCloseAt: optionalIso("bookingCloseAt"),
                  reason: form.get("reason"),
                }),
              scheduleAction === "cancel"
                ? "取消工作已排入；Zoom 成功後才會停用入場並通知學員。"
                : "改期工作已排入；Zoom 成功後才會更新權威時間與通知。",
            );
          }}
        >
          <h2>改期或緊急取消</h2>
          <label>
            動作
            <select
              value={scheduleAction}
              onChange={(event) =>
                setScheduleAction(event.target.value as "reschedule" | "cancel")
              }
            >
              <option value="reschedule">改期（保持原課程時長）</option>
              <option value="cancel">緊急取消</option>
            </select>
          </label>
          {scheduleAction === "reschedule" && (
            <>
              <label>
                新開始時間
                <input
                  defaultValue={localDateTime(startsAt)}
                  name="startsAt"
                  type="datetime-local"
                  required
                />
              </label>
              <label>
                新結束時間
                <input
                  defaultValue={localDateTime(endsAt)}
                  name="endsAt"
                  type="datetime-local"
                  required
                />
              </label>
              <label>
                新報名截止
                <input
                  defaultValue={localDateTime(bookingCloseAt)}
                  name="bookingCloseAt"
                  type="datetime-local"
                  required
                />
              </label>
            </>
          )}
          <label>
            原因
            <textarea name="reason" minLength={10} maxLength={2000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {scheduleAction === "cancel" ? "排入取消工作" : "排入改期工作"}
          </button>
        </form>
      )}
      {!canEditBreaks && !canSettle && !canReschedule && (
        <p className="closed-note">這個場次目前沒有可執行的管理操作。</p>
      )}
      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
