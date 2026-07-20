"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Headphones,
  LoaderCircle,
  LogIn,
  LogOut,
  Mic,
  ShieldAlert,
  Video,
} from "lucide-react";

type LiveSessionView = {
  id: string;
  title: string;
  courseTitle: string;
  instructorName: string;
  startsAt: string;
  endsAt: string;
  cameraRequiredPercent: number;
  status: string;
};
type Summary = {
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  camera_seconds: number;
  required_seconds: number;
  camera_percent: number;
  attendance_status: string;
  reasons?: string[];
};
type ZoomClient = {
  init(options: Record<string, unknown>): Promise<unknown>;
  join(options: Record<string, unknown>): Promise<unknown>;
  leaveMeeting(): Promise<unknown>;
  getCurrentUser(): { video?: boolean } | null;
  on(
    event: "connection-change",
    callback: (payload: { state?: string }) => void,
  ): void;
};

export function LiveClassroom({
  session,
  initialSummary,
}: {
  session: LiveSessionView;
  initialSummary?: Summary | null;
}) {
  const zoomRootRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomClientRef = useRef<ZoomClient | null>(null);
  const heartbeatSequence = useRef(0);
  const [equipment, setEquipment] = useState({
    camera: false,
    microphone: false,
    speaker: false,
  });
  const [summary, setSummary] = useState<Summary | null>(
    initialSummary ?? null,
  );
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void zoomClientRef.current?.leaveMeeting().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(async () => {
      const currentUser = zoomClientRef.current?.getCurrentUser();
      heartbeatSequence.current += 1;
      const response = await fetch(`/api/live/${session.id}/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cameraOn: Boolean(currentUser?.video),
          observedAt: new Date().toISOString(),
          pageVisible: document.visibilityState === "visible",
          sequence: heartbeatSequence.current,
        }),
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.summary) setSummary(result.summary);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [joined, session.id]);

  async function checkDevices() {
    setBusy(true);
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      setEquipment((value) => ({
        ...value,
        camera: stream.getVideoTracks().length > 0,
        microphone: stream.getAudioTracks().length > 0,
      }));
      setMessage("攝影機與麥克風已通過。請再按一次喇叭測試音。");
    } catch {
      setEquipment((value) => ({ ...value, camera: false, microphone: false }));
      setMessage(
        "無法使用攝影機或麥克風。請開啟瀏覽器權限；設備故障可提出人工異常申請。",
      );
    } finally {
      setBusy(false);
    }
  }

  function testSpeaker() {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.08;
    oscillator.frequency.value = 660;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    setEquipment((value) => ({ ...value, speaker: true }));
    setMessage("喇叭測試完成。若有聽到提示音，就可以簽到。");
  }

  async function attendanceAction(
    action: "check_in" | "check_out" | "exception_requested",
  ) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/live/${session.id}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        equipment,
        reason:
          action === "exception_requested"
            ? "直播設備故障，申請管理員人工審核"
            : undefined,
      }),
    });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok)
      return setMessage(
        result?.message ??
          (result?.error === "OUTSIDE_ATTENDANCE_WINDOW"
            ? "目前不在簽到退開放時間。"
            : "操作未完成，請稍後重試。"),
      );
    setSummary(result.summary);
    setMessage(
      action === "check_in"
        ? "簽到完成，可以進入教室。"
        : action === "check_out"
          ? "簽退完成，出席結果將由系統重新計算。"
          : "異常申請已送出，原始紀錄仍會保留供管理員審核。",
    );
  }

  async function joinMeeting() {
    setBusy(true);
    setMessage("");
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const response = await fetch("/api/zoom/signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveSessionId: session.id }),
      });
      const auth = await response.json();
      if (!response.ok)
        throw new Error(
          auth.error === "OUTSIDE_JOIN_WINDOW"
            ? "課前 10 分鐘才會開放教室。"
            : "目前無法取得安全入場權限。",
        );
      const zoomModule = await import("@zoom/meetingsdk/embedded");
      const client = zoomModule.default.createClient() as unknown as ZoomClient;
      zoomClientRef.current = client;
      await client.init({
        zoomAppRoot: zoomRootRef.current ?? undefined,
        language: "zh-TW",
        patchJsMedia: true,
        customize: { meetingInfo: [] },
      });
      client.on("connection-change", (payload) => {
        if (payload.state === "Closed") setJoined(false);
      });
      await client.join({
        signature: auth.signature,
        sdkKey: auth.sdkKey,
        meetingNumber: auth.meetingNumber,
        password: auth.passWord,
        userName: auth.userName,
        customerKey: auth.customerKey,
      });
      setJoined(true);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "加入教室失敗，請重新整理後再試。",
      );
    } finally {
      setBusy(false);
    }
  }

  const allDevicesReady =
    equipment.camera && equipment.microphone && equipment.speaker;
  return (
    <div className="min-h-screen bg-[#FFF8ED]">
      <header className="border-b border-[#EADFCF] bg-white">
        <div className="page-shell flex min-h-16 items-center gap-3">
          <Link
            href="/dashboard"
            className="grid size-11 place-items-center rounded-xl hover:bg-[#FFF8ED]"
            aria-label="返回學習中心"
          >
            <ChevronLeft />
          </Link>
          <div>
            <p className="font-black text-[#302318]">{session.courseTitle}</p>
            <p className="text-xs font-bold text-slate-500">
              {formatDateRange(session.startsAt, session.endsAt)}・
              {session.instructorName}
            </p>
          </div>
          <span className="ml-auto rounded-full bg-rose-100 px-3 py-1.5 text-xs font-black text-rose-700">
            同步直播
          </span>
        </div>
      </header>
      <main className="page-shell grid gap-6 py-7 xl:grid-cols-[1fr_360px]">
        <section className="panel overflow-hidden">
          <div className="border-b border-[#EADFCF] p-5">
            <p className="section-kicker">ZOOM MEETING SDK</p>
            <h1 className="mt-2 text-2xl font-black text-[#302318]">
              {session.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              只需登入歲悅帳號，不需建立 Zoom 帳號。會議密碼不會顯示或提供下載。
            </p>
          </div>
          <div
            ref={zoomRootRef}
            id="meetingSDKElement"
            className="min-h-[540px] bg-[#111817]"
          >
            {!joined && (
              <div className="grid min-h-[540px] place-items-center p-6 text-center text-white">
                <div>
                  <span className="mx-auto grid size-20 place-items-center rounded-full bg-white/10">
                    <Video className="size-9 text-[#F5C060]" />
                  </span>
                  <h2 className="mt-5 text-2xl font-black">教室尚未加入</h2>
                  <p className="mt-3 max-w-lg leading-7 text-slate-300">
                    先完成右側設備檢查與簽到。入場後，Zoom Component View
                    會直接顯示在這個區域。
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
        <aside className="space-y-5">
          <section className="panel p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
                <ShieldAlert />
              </span>
              <div>
                <h2 className="font-black text-[#302318]">設備檢查與簽到</h2>
                <p className="mt-1 text-xs text-slate-500">
                  簽到：課前 30 分至開課後 15 分
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <DeviceRow
                icon={<Camera />}
                label="攝影機"
                ready={equipment.camera}
              />
              <DeviceRow
                icon={<Mic />}
                label="麥克風"
                ready={equipment.microphone}
              />
              <DeviceRow
                icon={<Headphones />}
                label="喇叭"
                ready={equipment.speaker}
              />
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={checkDevices}
                disabled={busy}
                className="button-secondary min-h-11"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
                檢查攝影機與麥克風
              </button>
              <button
                type="button"
                onClick={testSpeaker}
                className="button-secondary min-h-11"
              >
                <Headphones className="size-4" />
                播放喇叭測試音
              </button>
            </div>
            {!summary?.checked_in_at && (
              <button
                type="button"
                onClick={() => attendanceAction("check_in")}
                disabled={!allDevicesReady || busy}
                className="button-primary mt-4 min-h-11 w-full disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <LogIn className="size-4" />
                完成簽到
              </button>
            )}
            {!allDevicesReady && (
              <button
                type="button"
                onClick={() => attendanceAction("exception_requested")}
                disabled={busy}
                className="mt-3 min-h-11 w-full text-sm font-black text-amber-800 underline"
              >
                設備故障，提出異常申請
              </button>
            )}
            {summary?.checked_in_at && !joined && (
              <button
                type="button"
                onClick={joinMeeting}
                disabled={busy}
                className="button-primary mt-4 min-h-11 w-full"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Video className="size-4" />
                )}
                進入同步教室
              </button>
            )}
            <button
              type="button"
              onClick={() => attendanceAction("check_out")}
              disabled={busy || Boolean(summary?.checked_out_at)}
              className="button-secondary mt-3 min-h-11 w-full"
            >
              <LogOut className="size-4" />
              {summary?.checked_out_at ? "已完成簽退" : "下課簽退"}
            </button>
            {message && (
              <p
                role="status"
                className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900"
              >
                {message}
              </p>
            )}
          </section>
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-5 text-[#B45309]" />
              <h2 className="font-black text-[#302318]">本人出席狀態</h2>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <StatusCell
                label="簽到"
                value={summary?.checked_in_at ? "完成" : "未完成"}
              />
              <StatusCell
                label="簽退"
                value={summary?.checked_out_at ? "完成" : "未完成"}
              />
              <StatusCell
                label="有效鏡頭"
                value={`${summary?.camera_percent?.toFixed(1) ?? "0.0"}%`}
              />
              <StatusCell
                label="門檻"
                value={`${session.cameraRequiredPercent}%`}
              />
            </dl>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              每 15 秒回報一次鏡頭狀態，只有 Zoom webhook
              顯示仍在線、且心跳間隔未超過 45
              秒的區段才會累計；正式休息不列入分母。
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}

function DeviceRow({
  icon,
  label,
  ready,
}: {
  icon: React.ReactNode;
  label: string;
  ready: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[#EADFCF] px-3">
      <span className={ready ? "text-emerald-600" : "text-slate-400"}>
        {icon}
      </span>
      <span className="flex-1 text-sm font-black text-[#302318]">{label}</span>
      {ready ? (
        <CheckCircle2 className="size-5 text-emerald-600" />
      ) : (
        <span className="text-xs font-bold text-slate-400">待檢查</span>
      )}
    </div>
  );
}
function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#FFF8ED] p-3">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className="mt-1 font-black text-[#302318]">{value}</dd>
    </div>
  );
}
function formatDateRange(startsAt: string, endsAt: string) {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${new Intl.DateTimeFormat("zh-TW", options).format(new Date(startsAt))}–${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(endsAt))}`;
}
