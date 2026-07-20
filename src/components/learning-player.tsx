"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileQuestion,
  ListVideo,
  LoaderCircle,
  ShieldCheck,
  WifiOff,
  X,
} from "lucide-react";
import type { Course } from "@/lib/data";

type StreamPlayer = {
  currentTime: number;
  paused: boolean;
  play(): void;
  pause(): void;
  on(event: string, callback: () => void): void;
  off?(event: string, callback: () => void): void;
};
declare global {
  interface Window {
    Stream?: (element: HTMLIFrameElement) => StreamPlayer;
  }
}

export function LearningPlayer({
  course,
  lessonId,
  access,
  preview = false,
  resumePosition = 0,
  presenceInterval,
}: {
  course: Course;
  lessonId: string;
  access: boolean;
  preview?: boolean;
  resumePosition?: number;
  presenceInterval: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const sessionRef = useRef<string | null>(null);
  const positionRef = useRef(resumePosition);
  const playingRef = useRef(false);
  const [iframeUrl, setIframeUrl] = useState("");
  const [message, setMessage] = useState("");
  const [lastSaved, setLastSaved] = useState("尚未開始");
  const [visible, setVisible] = useState(true);
  const [online, setOnline] = useState(true);
  const [position, setPosition] = useState(resumePosition);
  const [presence, setPresence] = useState<{
    id: string;
    expires_at: string;
  } | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ended, setEnded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [certificate, setCertificate] = useState("");

  useEffect(() => {
    if (!access) return;
    const controller = new AbortController();
    fetch("/api/stream/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lessonId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setIframeUrl(result.iframeUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setMessage("目前無法取得安全播放網址，請稍後再試或聯絡客服。");
      });
    return () => controller.abort();
  }, [access, lessonId]);
  useEffect(() => {
    const visibility = () => {
      const value = document.visibilityState === "visible";
      setVisible(value);
      if (!value) playerRef.current?.pause();
    };
    const network = () => setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);

  const startSession = useCallback(
    async (takeOver = false) => {
      if (sessionRef.current) return sessionRef.current;
      let fingerprint = localStorage.getItem("suiyue-device-id");
      if (!fingerprint) {
        fingerprint = crypto.randomUUID();
        localStorage.setItem("suiyue-device-id", fingerprint);
      }
      const response = await fetch("/api/playback/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId,
          deviceFingerprint: fingerprint,
          takeOver,
        }),
      });
      const result = await response.json();
      if (response.status === 409 && result.error === "ACTIVE_SESSION_EXISTS") {
        setTakeover(true);
        playerRef.current?.pause();
        throw new Error("ACTIVE_SESSION_EXISTS");
      }
      if (!response.ok) throw new Error(result.error);
      sessionRef.current = result.sessionId;
      setSessionId(result.sessionId);
      setTakeover(false);
      return result.sessionId as string;
    },
    [lessonId],
  );

  const sendHeartbeat = useCallback(
    async (options?: { confirmChallengeId?: string; ended?: boolean }) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      const response = await fetch("/api/progress/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          positionSeconds: Math.max(0, Math.floor(positionRef.current)),
          pageVisible: document.visibilityState === "visible",
          playerPlaying: playingRef.current,
          online: navigator.onLine,
          ...options,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error === "SESSION_INACTIVE") setTakeover(true);
        throw new Error(result.error);
      }
      setLastSaved("剛剛");
      if (result.presenceRequired) {
        setPresence(result.presenceRequired);
        playerRef.current?.pause();
      }
      if (result.ended) setEnded(true);
      if (result.completion?.verificationCode)
        setCertificate(result.completion.verificationCode);
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(
      () => sendHeartbeat().catch(() => setLastSaved("等待連線")),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [sendHeartbeat, sessionId]);

  const bindPlayer = useCallback(() => {
    if (!iframeRef.current || !window.Stream || playerRef.current) return;
    const player = window.Stream(iframeRef.current);
    playerRef.current = player;
    player.on("loadedmetadata", () => {
      if (resumePosition > 0) player.currentTime = resumePosition;
    });
    player.on("play", () => {
      playingRef.current = true;
      startSession().catch(() => undefined);
    });
    player.on("pause", () => {
      playingRef.current = false;
    });
    player.on("timeupdate", () => {
      positionRef.current = player.currentTime;
      setPosition(Math.floor(player.currentTime));
    });
    player.on("ended", () => {
      playingRef.current = false;
      sendHeartbeat({ ended: true }).catch(() => setLastSaved("等待連線"));
    });
  }, [resumePosition, sendHeartbeat, startSession]);

  async function confirmPresence() {
    if (!presence) return;
    try {
      await sendHeartbeat({ confirmChallengeId: presence.id });
      setPresence(null);
      playerRef.current?.play();
    } catch {
      setMessage("在席確認已逾時，這個區段不會列入有效時數。請重新開始播放。");
      setPresence(null);
    }
  }
  async function takeOverSession() {
    try {
      await startSession(true);
      playerRef.current?.play();
    } catch {
      setMessage("無法切換播放裝置，請稍後再試。");
    }
  }

  if (!access) return <AccessGate course={course} preview={preview} />;
  const lessonIndex = Math.max(
    0,
    course.chapters.findIndex((chapter) => chapter.id === lessonId),
  );
  const currentLesson = course.chapters[lessonIndex];
  const nextLesson = course.chapters[lessonIndex + 1];
  const lessonDuration =
    currentLesson?.durationSeconds ?? course.durationSeconds;
  const progress = Math.min(
    100,
    Math.round((position / Math.max(1, lessonDuration)) * 100),
  );
  return (
    <div className="learning-shell min-h-screen bg-[#1D160F] text-white">
      <Script
        src="https://embed.cloudflarestream.com/embed/sdk.latest.js"
        strategy="afterInteractive"
        onLoad={bindPlayer}
      />
      <header className="flex min-h-16 items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="grid size-11 place-items-center rounded-lg hover:bg-white/10"
          aria-label="返回我的學習"
        >
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{course.title}</p>
          <p className="truncate text-xs text-[#CBB79F]">
            {currentLesson?.title ?? "課程單元"}
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300 sm:flex">
          <span className="size-2 rounded-full bg-emerald-400" />
          進度已儲存・{lastSaved}
        </div>
        <button
          onClick={() => setSidebarOpen((value) => !value)}
          className="grid size-11 place-items-center rounded-lg hover:bg-white/10"
          aria-label="切換單元列表"
        >
          <ListVideo className="size-5" />
        </button>
      </header>
      <div
        className={`grid ${sidebarOpen ? "lg:grid-cols-[1fr_340px]" : "grid-cols-1"}`}
      >
        <main className="min-w-0">
          <div className="relative flex aspect-video min-h-[300px] items-center justify-center bg-black">
            {iframeUrl ? (
              <iframe
                ref={iframeRef}
                src={iframeUrl}
                onLoad={bindPlayer}
                className="absolute inset-0 size-full border-0"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={course.title}
              />
            ) : (
              <LoaderCircle className="size-10 animate-spin text-[#F5C060]" />
            )}
            {!visible && (
              <div className="absolute inset-x-0 top-0 z-10 bg-amber-400 px-4 py-3 text-center text-sm font-black text-[#302318]">
                頁面不在前景，影片已暫停且不計入時數
              </div>
            )}
            {!online && (
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 bg-rose-600 px-4 py-3 text-sm font-black">
                <WifiOff className="size-4" />
                網路已中斷，離線區段不計入
              </div>
            )}
          </div>
          <div className="border-t border-white/10 px-5 py-5">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#EA880C]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-[#D6C3AD]">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#EA880C]/15 px-3 py-1.5 text-[#FDE8BC]">
                <ShieldCheck className="size-4" />每 {presenceInterval / 60}{" "}
                分鐘在席確認
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5">
                <Clock3 className="size-4" />
                目前位置 {formatTime(position)} / {formatTime(lessonDuration)}
              </span>
              {ended && nextLesson?.id && (
                <Link
                  className="button-primary ml-auto"
                  href={`/learn/${course.slug}?lesson=${nextLesson.id}`}
                >
                  <ChevronRight className="size-4" />
                  下一單元
                </Link>
              )}
              {ended && !nextLesson && !certificate && (
                <Link
                  className="button-primary ml-auto"
                  href={`/quiz/${course.slug}`}
                >
                  <FileQuestion className="size-4" />
                  前往測驗
                </Link>
              )}
              {certificate && (
                <Link
                  className="button-primary ml-auto"
                  href={`/certificate/${certificate}`}
                >
                  <FileQuestion className="size-4" />
                  查看完課證明
                </Link>
              )}
            </div>
            {message && (
              <p className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">
                {message}
              </p>
            )}
          </div>
        </main>
        {sidebarOpen && (
          <aside className="hidden border-l border-white/10 bg-[#2A2118] lg:block">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <h2 className="font-black">課程單元</h2>
              <button
                className="grid size-10 place-items-center rounded-lg hover:bg-white/10"
                onClick={() => setSidebarOpen(false)}
                aria-label="關閉"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="grid gap-2 p-4" aria-label="課程單元">
              {course.chapters.map((chapter, index) => (
                <Link
                  key={chapter.id ?? chapter.title}
                  href={`/learn/${course.slug}?lesson=${chapter.id}`}
                  className={`flex min-h-14 gap-3 rounded-xl p-4 ${chapter.id === lessonId ? "bg-[#EA880C]/15 ring-1 ring-[#F5C060]/50" : "hover:bg-white/5"}`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-black ${chapter.id === lessonId ? "border-[#F5C060]" : "border-white/20"}`}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-bold">
                      {chapter.title}
                    </span>
                    <span className="mt-1 block text-xs text-[#BDA78F]">
                      {chapter.duration}
                      {chapter.preview ? "・可試看" : "・付費單元"}
                    </span>
                  </span>
                </Link>
              ))}
            </nav>
            <div className="mx-4 mb-4 rounded-xl border border-white/10 p-4 text-xs leading-6 text-[#CBB79F]">
              有效時數由伺服器依
              heartbeat、前景狀態和在席確認計算；播放器秒數只作為續播位置參考。
            </div>
          </aside>
        )}
      </div>
      {presence && (
        <Modal
          icon={<AlertCircle className="size-8" />}
          title="還在上課嗎？"
          text={`影片已暫停。請在 2 分鐘內確認，剛才的 ${presenceInterval / 60} 分鐘才會計入有效學習時數。`}
          action="我還在上課，繼續播放"
          onAction={confirmPresence}
        />
      )}
      {takeover && (
        <Modal
          icon={<ShieldCheck className="size-8" />}
          title="此帳號正在其他裝置播放"
          text="同一帳號只允許一個有效播放工作階段。若切換到這台裝置，另一台會停止計時。"
          action="切換到這台裝置"
          onAction={takeOverSession}
        />
      )}
    </div>
  );
}

function AccessGate({ course, preview }: { course: Course; preview: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#FFF8ED] p-5">
      <div className="max-w-lg rounded-3xl border border-[#EADFCF] bg-white p-8 text-center shadow-xl">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]">
          <ShieldCheck className="size-8" />
        </span>
        <h1 className="mt-5 text-2xl font-black text-[#302318]">
          {preview ? "這是受保護播放器預覽" : "需要有效的課程權限"}
        </h1>
        <p className="mt-3 leading-7 text-slate-500">
          {preview
            ? "預覽模式不會播放付費影片或寫入學習時數。"
            : "付款返回頁不會自行解鎖；請等待綠界伺服器通知確認成功。"}
        </p>
        <div className="mt-7 grid gap-3">
          <Link className="button-primary" href={`/checkout/${course.slug}`}>
            前往測試購課
          </Link>
          <Link className="button-secondary" href="/dashboard">
            回到我的學習
          </Link>
        </div>
      </div>
    </main>
  );
}
function Modal({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center text-[#302318]">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]">
          {icon}
        </span>
        <h2 className="mt-5 text-2xl font-black">{title}</h2>
        <p className="mt-3 leading-7 text-slate-600">{text}</p>
        <button
          onClick={onAction}
          className="button-primary button-large mt-6 w-full"
        >
          <CheckCircle2 className="size-5" />
          {action}
        </button>
      </div>
    </div>
  );
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
