"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarPlus,
  CircleStop,
  LoaderCircle,
  Radio,
  Users,
  Video,
} from "lucide-react";

export type LiveCourseOption = {
  id: string;
  title: string;
  accredited: boolean;
};
export type LiveSessionRow = {
  id: string;
  course_id: string;
  title: string;
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  capacity: number;
  host_plan_capacity: number;
  zoom_status: string;
  camera_required_percent: number;
  courses?:
    | { title: string; slug?: string; accredited?: boolean }
    | Array<{ title: string; slug?: string; accredited?: boolean }>;
  live_session_bookings?: Array<{ id: string; status: string }>;
  live_attendance_summaries?: Array<{ attendance_status: string }>;
};

export function AdminLiveManager({
  courses,
  initialSessions,
  enabled,
  readOnly,
}: {
  courses: LiveCourseOption[];
  initialSessions: LiveSessionRow[];
  enabled: boolean;
  readOnly: boolean;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    readOnly ? "客服模式：可查看場次與異常狀態，但不能變更出席結果。" : "",
  );

  async function reload() {
    const response = await fetch("/api/admin/live-sessions");
    const result = await response.json();
    if (response.ok) setSessions(result.sessions);
  }
  async function createSession(formData: FormData) {
    setBusy(true);
    setMessage("");
    const startsAt = new Date(String(formData.get("startsAt"))).toISOString();
    const endsAt = new Date(String(formData.get("endsAt"))).toISOString();
    const breakStart = String(formData.get("breakStart") || "");
    const breakEnd = String(formData.get("breakEnd") || "");
    const breaks =
      breakStart && breakEnd
        ? [
            {
              startsAt: new Date(breakStart).toISOString(),
              endsAt: new Date(breakEnd).toISOString(),
            },
          ]
        : [];
    const response = await fetch("/api/admin/live-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        courseId: formData.get("courseId"),
        title: formData.get("title"),
        instructorName: formData.get("instructorName"),
        startsAt,
        endsAt,
        capacity: Number(formData.get("capacity")),
        hostPlanCapacity: Number(formData.get("hostPlanCapacity")),
        breaks,
      }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok)
      return setMessage(
        result.message ?? "場次建立失敗，請檢查時間、課程與 Zoom 設定。",
      );
    setMessage(
      result.zoomError
        ? "場次草稿已建立，但 Zoom 會議建立失敗；修正設定後再重試。"
        : "場次與 Zoom 會議已建立，確認後即可開放販售。",
    );
    await reload();
  }
  async function action(
    sessionId: string,
    type: "open_sales" | "end" | "cancel",
  ) {
    const reason =
      type === "cancel"
        ? window.prompt("請填寫取消原因（至少 5 個字）")
        : undefined;
    if (type === "cancel" && !reason) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/admin/live-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: type, reason }),
    });
    const result = await response.json();
    setBusy(false);
    setMessage(
      response.ok
        ? type === "open_sales"
          ? "場次已開放販售。"
          : type === "end"
            ? "場次已結束，出席摘要可進行覆核。"
            : "場次已取消，請人工安排轉班或退款。"
        : (result.message ?? "操作失敗。"),
    );
    if (response.ok) await reload();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
            <CalendarPlus />
          </span>
          <div>
            <h2 className="text-lg font-black text-[#302318]">建立直播場次</h2>
            <p className="mt-1 text-xs text-slate-500">
              Zoom 會議由歲悅帳戶自動建立
            </p>
          </div>
        </div>
        <form action={createSession} className="mt-5 grid gap-4">
          <Field label="直播課程">
            <select name="courseId" className="field" required>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.accredited ? "（積分）" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="場次名稱">
            <input name="title" className="field" required minLength={3} />
          </Field>
          <Field label="講師">
            <input
              name="instructorName"
              className="field"
              required
              minLength={2}
            />
          </Field>
          <Field label="開始時間">
            <input
              name="startsAt"
              type="datetime-local"
              className="field"
              required
            />
          </Field>
          <Field label="結束時間">
            <input
              name="endsAt"
              type="datetime-local"
              className="field"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="販售名額">
              <input
                name="capacity"
                type="number"
                min="1"
                defaultValue="50"
                className="field"
                required
              />
            </Field>
            <Field label="Zoom 方案上限">
              <input
                name="hostPlanCapacity"
                type="number"
                min="1"
                defaultValue="100"
                className="field"
                required
              />
            </Field>
          </div>
          <div className="rounded-xl bg-[#FFF8ED] p-4">
            <p className="text-xs font-black text-[#694115]">
              正式休息（選填）
            </p>
            <div className="mt-3 grid gap-3">
              <input
                aria-label="休息開始"
                name="breakStart"
                type="datetime-local"
                className="field"
              />
              <input
                aria-label="休息結束"
                name="breakEnd"
                type="datetime-local"
                className="field"
              />
            </div>
          </div>
          <button
            disabled={!enabled || busy || courses.length === 0}
            className="button-primary min-h-11"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Video className="size-4" />
            )}
            建立場次與 Zoom 會議
          </button>
        </form>
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-kicker">LIVE OPERATIONS</p>
            <h2 className="mt-2 text-xl font-black text-[#302318]">
              全部同步場次
            </h2>
          </div>
          <span className="rounded-full bg-[#FFF0D5] px-3 py-1.5 text-xs font-black text-[#8A4800]">
            {sessions.length} 場
          </span>
        </div>
        {sessions.map((session) => {
          const course = Array.isArray(session.courses)
            ? session.courses[0]
            : session.courses;
          const sold =
            session.live_session_bookings?.filter(
              (item) => item.status === "confirmed",
            ).length ?? 0;
          const anomalies =
            session.live_attendance_summaries?.filter((item) =>
              ["needs_review", "disqualified"].includes(item.attendance_status),
            ).length ?? 0;
          return (
            <article key={session.id} className="panel p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
                  <Radio />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-[#302318]">
                      {session.title}
                    </h3>
                    <Badge value={session.status} />
                    <Badge value={`Zoom ${session.zoom_status}`} />
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    {course?.title ?? "直播課"}・
                    {formatDate(session.starts_at, session.ends_at)}・
                    {session.instructor_name}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs font-bold text-slate-500">
                    <span>
                      <Users className="mr-1 inline size-4" />
                      已售 {sold}/{session.capacity}
                    </span>
                    <span>鏡頭門檻 {session.camera_required_percent}%</span>
                    <span
                      className={
                        anomalies ? "text-rose-700" : "text-emerald-700"
                      }
                    >
                      異常 {anomalies} 人
                    </span>
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {["scheduled", "draft"].includes(session.status) && (
                      <button
                        onClick={() => action(session.id, "open_sales")}
                        disabled={busy}
                        className="button-secondary min-h-11"
                      >
                        開放販售
                      </button>
                    )}
                    {["open", "scheduled"].includes(session.status) && (
                      <button
                        onClick={() => action(session.id, "end")}
                        disabled={busy}
                        className="button-secondary min-h-11"
                      >
                        <CircleStop className="size-4" />
                        結束
                      </button>
                    )}
                    {!["ended", "cancelled"].includes(session.status) && (
                      <button
                        onClick={() => action(session.id, "cancel")}
                        disabled={busy}
                        className="button-secondary min-h-11 text-rose-700"
                      >
                        取消場次
                      </button>
                    )}
                  </div>
                )}
                <Link
                  href={`/admin/live/${session.id}`}
                  className="button-secondary min-h-11"
                >
                  出席名單與覆核
                </Link>
              </div>
            </article>
          );
        })}
        {sessions.length === 0 && (
          <div className="panel p-8 text-center text-sm font-bold text-slate-500">
            尚未建立直播場次。
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
      </section>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-black text-[#302318]">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Badge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
      {value}
    </span>
  );
}
function formatDate(start: string, end: string) {
  return `${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(start))}–${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`;
}
