"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Booking = {
  bookingId: string;
  sessionId: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  changeLockedAt: string;
  canChange: boolean;
  canJoin: boolean;
  replacementSessions: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    bookingCloseAt: string;
  }[];
};

const bookingLabels: Record<string, string> = {
  held: "付款保留中",
  confirmed: "已報名",
  attended: "已出席",
  cancelled: "場次已取消",
  released: "名額已釋放",
};

function remainingLabel(startsAt: string, now: number) {
  const seconds = Math.floor((Date.parse(startsAt) - now) / 1000);
  if (seconds <= 0) return "已到開課時間";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小時後開課`;
  if (hours > 0) return `${hours} 小時 ${minutes} 分後開課`;
  return `${Math.max(1, minutes)} 分鐘後開課`;
}

export function LiveBookingCard({ booking }: { booking: Booking }) {
  const [now, setNow] = useState(0);
  const [replacementSessionId, setReplacementSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <article className="live-booking-card">
      <div>
        <p className="status">
          {bookingLabels[booking.status] ?? "狀態確認中"}
        </p>
        <h3>{booking.title}</h3>
        <p>
          {new Date(booking.startsAt).toLocaleString("zh-TW")} 至{" "}
          {new Date(booking.endsAt).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <strong>
          {now ? remainingLabel(booking.startsAt, now) : "計算倒數中…"}
        </strong>
      </div>
      <div className="workspace-actions">
        {booking.status === "confirmed" && (
          <a
            className="button secondary"
            href={`/api/live/${booking.sessionId}/calendar`}
          >
            加入手機行事曆
          </a>
        )}
        {booking.canJoin ? (
          <Link className="button" href={`/live/${booking.sessionId}`}>
            設備檢查並進入教室
          </Link>
        ) : (
          <span className="closed-note">尚未開放進入教室</span>
        )}
      </div>
      {booking.canChange && booking.replacementSessions.length > 0 && (
        <form
          className="context-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!replacementSessionId) return;
            setBusy(true);
            setMessage("正在重新確認名額…");
            void fetch(
              `/api/live/bookings/${encodeURIComponent(booking.bookingId)}/change`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": crypto.randomUUID(),
                },
                body: JSON.stringify({ replacementSessionId }),
              },
            )
              .then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok) {
                  throw new Error(result?.error ?? "CHANGE_REJECTED");
                }
                setMessage("新場次已確認，頁面即將更新。");
                window.setTimeout(() => window.location.reload(), 500);
              })
              .catch(() =>
                setMessage(
                  "未完成更換；伺服器重新檢查後，名額可能已滿、超過 24 小時期限或先修尚未完成。",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            更換到其他場次
            <select
              value={replacementSessionId}
              onChange={(event) => setReplacementSessionId(event.target.value)}
              required
            >
              <option value="">請選擇仍有名額的場次</option>
              {booking.replacementSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}－
                  {new Date(session.startsAt).toLocaleString("zh-TW")}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {busy ? "確認名額中…" : "確認更換場次"}
          </button>
          <p aria-live="polite">{message}</p>
        </form>
      )}
      <p className="muted-copy">
        {booking.status === "cancelled" && booking.canChange
          ? "原場次已取消；可免費選擇上方替代場次，或回訂單頁申請退款。"
          : booking.canChange
            ? `可在 ${new Date(booking.changeLockedAt).toLocaleString("zh-TW")} 前依規則更換場次。`
            : booking.status === "cancelled"
              ? "原場次已取消；若沒有可選替代場次，請由訂單頁申請退款。"
              : "已超過自行更換場次時間；需要協助請聯絡客服。"}
      </p>
    </article>
  );
}
