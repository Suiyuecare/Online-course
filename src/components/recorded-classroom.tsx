"use client";

import { Stream, type StreamPlayerApi } from "@cloudflare/stream-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { playbackTokenRefreshDelayMs } from "@/domain/playback";
import {
  type HeartbeatDeliveryResult,
  SequentialHeartbeatQueue,
} from "@/domain/sequential-heartbeat";

type PlaybackSession = {
  status: "authorized";
  enrollmentId: string;
  playbackToken: string;
  playbackExpiresAt: string;
  playbackSessionId: string;
  leaseEpoch: number;
  overlay: string;
  capabilityNotice: string;
  challengeRequired?: boolean;
  challengeToken?: string | null;
  challengeTimedOut?: boolean;
  challengeExpiresAt?: string | null;
  challengeOriginLessonId?: string | null;
  challengeOriginVideoVersionId?: string | null;
  challengeOriginPositionSeconds?: number | null;
  rewindToSeconds?: number | null;
  resumeAtSeconds?: number | null;
};

type RewindOriginRequired = {
  status: "rewind_origin_required";
  enrollmentId: string;
  challengeTimedOut: boolean;
  challengeOriginLessonId: string;
  challengeOriginVideoVersionId: string;
  challengeOriginPositionSeconds: number;
  rewindToSeconds: number;
};

type ChallengeOrigin = {
  lessonId: string | null;
  videoVersionId: string | null;
  positionSeconds: number | null;
};

type RecordedHeartbeatSnapshot = {
  enrollmentId: string;
  playbackSessionId: string;
  leaseEpoch: number;
  mediaPositionSeconds: number;
  playing: boolean;
  visible: boolean;
  online: boolean;
  challengeToken: string | null;
};

type RecordedHeartbeatStateOverride = Partial<
  Pick<RecordedHeartbeatSnapshot, "playing" | "visible" | "online">
>;

function challengeOriginFrom(payload: {
  challengeOriginLessonId?: string | null;
  challengeOriginVideoVersionId?: string | null;
  challengeOriginPositionSeconds?: number | null;
  originLessonId?: string | null;
  originVideoVersionId?: string | null;
  originPositionSeconds?: number | null;
}): ChallengeOrigin {
  return {
    lessonId: payload.challengeOriginLessonId ?? payload.originLessonId ?? null,
    videoVersionId:
      payload.challengeOriginVideoVersionId ??
      payload.originVideoVersionId ??
      null,
    positionSeconds:
      payload.challengeOriginPositionSeconds ??
      payload.originPositionSeconds ??
      null,
  };
}

function challengeRemainingSeconds(expiresAt?: string | null): number {
  const expiry = Date.parse(expiresAt ?? "");
  return Number.isFinite(expiry)
    ? Math.max(0, Math.ceil((expiry - Date.now()) / 1000))
    : 0;
}

function normalizedCustomerCode(value: string): string {
  return value
    .trim()
    .replace(/^https:\/\/customer-/i, "")
    .replace(/^customer-/i, "")
    .replace(/\.cloudflarestream\.com.*$/i, "");
}

export function RecordedClassroom({
  enrollmentId,
  lessonVideoVersionId,
  customerCode,
}: {
  enrollmentId: string;
  lessonVideoVersionId: string;
  customerCode?: string;
}) {
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [error, setError] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeSeconds, setChallengeSeconds] = useState(90);
  const [challengeOrigin, setChallengeOrigin] =
    useState<ChallengeOrigin | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const mediaPosition = useRef(0);
  const actuallyPlaying = useRef(false);
  const player = useRef<StreamPlayerApi | undefined>(undefined);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const challengeTokenRef = useRef<string | null>(null);
  const challengeConfirmationKey = useRef<string | null>(null);
  const activeSessionId = useRef<string | null>(null);
  const playbackAuthorized = useRef(false);
  const startInFlight = useRef(false);
  const refreshing = useRef(false);
  const resumeAfterRefresh = useRef(false);
  const ignorePlayerErrorUntil = useRef(0);
  const heartbeatDelivery = useRef<
    (
      snapshot: RecordedHeartbeatSnapshot,
      sequence: number,
    ) => Promise<HeartbeatDeliveryResult>
  >(async () => "stop");
  const heartbeatQueue =
    useRef<SequentialHeartbeatQueue<RecordedHeartbeatSnapshot> | null>(null);

  const ensureHeartbeatQueue = useCallback(() => {
    if (!heartbeatQueue.current) {
      heartbeatQueue.current =
        new SequentialHeartbeatQueue<RecordedHeartbeatSnapshot>(
          0,
          (snapshot, nextSequence) =>
            heartbeatDelivery.current(snapshot, nextSequence),
        );
    }
    return heartbeatQueue.current;
  }, []);

  const pausePlayer = useCallback(() => {
    player.current?.pause();
    actuallyPlaying.current = false;
    setPlaying(false);
  }, []);

  const applyChallengeTimeout = useCallback(
    (origin: ChallengeOrigin | null) => {
      pausePlayer();
      if (
        origin?.lessonId &&
        origin.videoVersionId &&
        origin.videoVersionId !== lessonVideoVersionId
      ) {
        window.location.assign(
          `/learner/courses/${encodeURIComponent(enrollmentId)}?lesson=${encodeURIComponent(origin.lessonId)}#lesson-player`,
        );
        return;
      }
      if (typeof origin?.positionSeconds === "number") {
        mediaPosition.current = origin.positionSeconds;
        if (player.current) {
          player.current.currentTime = origin.positionSeconds;
        }
      }
    },
    [enrollmentId, lessonVideoVersionId, pausePlayer],
  );

  const updateChallengeToken = useCallback((value: string | null) => {
    if (value && value !== challengeTokenRef.current) {
      challengeConfirmationKey.current = crypto.randomUUID();
    } else if (!value) {
      challengeConfirmationKey.current = null;
    }
    challengeTokenRef.current = value;
    setChallengeToken(value);
  }, []);

  const applyRewindOriginRequired = useCallback(
    (directive: RewindOriginRequired) => {
      heartbeatQueue.current?.stop();
      playbackAuthorized.current = false;
      activeSessionId.current = null;
      sessionRef.current = null;
      pausePlayer();
      setSession(null);
      updateChallengeToken(null);
      const origin = challengeOriginFrom(directive);
      setChallengeOrigin(origin);
      setError(
        directive.challengeTimedOut
          ? "上一個在席確認已逾時，該區塊不計入。系統正帶你回到原課程起點重新觀看。"
          : "請先回到上一個在席確認的原課程起點，重新觀看後才能繼續其他單元。",
      );
      applyChallengeTimeout(origin);
    },
    [applyChallengeTimeout, pausePlayer, updateChallengeToken],
  );

  const enqueueHeartbeat = useCallback(
    (override?: RecordedHeartbeatStateOverride) => {
      const currentSession = sessionRef.current;
      if (
        !currentSession ||
        activeSessionId.current !== currentSession.playbackSessionId
      ) {
        return false;
      }
      return ensureHeartbeatQueue().enqueue({
        enrollmentId: currentSession.enrollmentId,
        playbackSessionId: currentSession.playbackSessionId,
        leaseEpoch: currentSession.leaseEpoch,
        mediaPositionSeconds: mediaPosition.current,
        playing:
          (override?.playing ?? actuallyPlaying.current) &&
          !challengeTokenRef.current,
        visible: override?.visible ?? document.visibilityState === "visible",
        online: override?.online ?? navigator.onLine,
        challengeToken: challengeTokenRef.current,
      });
    },
    [ensureHeartbeatQueue],
  );

  async function start() {
    if (startInFlight.current) return;
    setError("");
    if (
      !window.confirm(
        "開始播放後，若這個帳號正在其他分頁或裝置上課，舊畫面會停止計時。要由這個畫面接管嗎？",
      )
    ) {
      return;
    }
    startInFlight.current = true;
    let response: Response;
    try {
      response = await fetch("/api/playback/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ enrollmentId, lessonVideoVersionId }),
      });
    } catch {
      startInFlight.current = false;
      setError("目前無法連線驗證課程，請確認網路後再試。");
      return;
    }
    const payload = (await response.json().catch(() => null)) as {
      data?: PlaybackSession | RewindOriginRequired;
    } | null;
    if (
      response.ok &&
      payload?.data?.status === "rewind_origin_required" &&
      payload.data.enrollmentId === enrollmentId
    ) {
      startInFlight.current = false;
      applyRewindOriginRequired(payload.data);
      return;
    }
    if (
      !response.ok ||
      !payload?.data ||
      payload.data.status !== "authorized" ||
      payload.data.enrollmentId !== enrollmentId
    ) {
      startInFlight.current = false;
      setError("目前無法開啟影片。請確認付款、積分核定與課程開放狀態。");
      return;
    }
    ensureHeartbeatQueue().reset(0);
    mediaPosition.current =
      payload.data.rewindToSeconds ?? payload.data.resumeAtSeconds ?? 0;
    actuallyPlaying.current = false;
    const origin = challengeOriginFrom(payload.data);
    setChallengeOrigin(
      payload.data.challengeRequired || payload.data.challengeTimedOut
        ? origin
        : null,
    );
    if (payload.data.challengeTimedOut) {
      setError("上一個在席確認已逾時，該區塊不計入；請從原區塊起點重新觀看。");
      applyChallengeTimeout(origin);
    }
    if (payload.data.challengeRequired && payload.data.challengeToken) {
      updateChallengeToken(payload.data.challengeToken);
      setChallengeSeconds(
        challengeRemainingSeconds(payload.data.challengeExpiresAt),
      );
    } else {
      updateChallengeToken(null);
    }
    activeSessionId.current = payload.data.playbackSessionId;
    sessionRef.current = payload.data;
    playbackAuthorized.current = true;
    setSession(payload.data);
    startInFlight.current = false;
  }

  const resumePlayer = useCallback(async () => {
    if (!player.current || challengeToken) return;
    if (!playbackAuthorized.current) {
      setError("安全播放資格尚未恢復，請重新驗證後再播放。");
      return;
    }
    player.current.playbackRate = 1;
    try {
      await player.current.play();
    } catch {
      setError("瀏覽器暫時阻擋播放，請再按一次繼續上課。");
    }
  }, [challengeToken]);

  const rewindPlayer = useCallback(() => {
    if (!player.current) return;
    player.current.currentTime = Math.max(0, player.current.currentTime - 15);
    mediaPosition.current = player.current.currentTime;
  }, []);

  const refreshPlayback = useCallback(async () => {
    if (!session || refreshing.current) return false;
    refreshing.current = true;
    const shouldResume = actuallyPlaying.current && !challengeToken;
    const currentPosition = mediaPosition.current;
    playbackAuthorized.current = false;
    pausePlayer();
    try {
      const response = await fetch("/api/playback/refresh", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          enrollmentId,
          playbackSessionId: session.playbackSessionId,
          leaseEpoch: session.leaseEpoch,
          lessonVideoVersionId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: PlaybackSession | RewindOriginRequired;
      } | null;
      if (
        response.ok &&
        payload?.data?.status === "rewind_origin_required" &&
        payload.data.enrollmentId === enrollmentId
      ) {
        applyRewindOriginRequired(payload.data);
        return false;
      }
      if (
        !response.ok ||
        !payload?.data ||
        payload.data.status !== "authorized" ||
        payload.data.enrollmentId !== enrollmentId
      ) {
        setError("觀看資格已失效，影片已停止。請重新驗證付款與修課資格。");
        return false;
      }
      const targetPosition =
        payload.data.rewindToSeconds ??
        payload.data.resumeAtSeconds ??
        currentPosition;
      const origin = challengeOriginFrom(payload.data);
      ensureHeartbeatQueue().reset(0);
      mediaPosition.current = targetPosition;
      resumeAfterRefresh.current =
        shouldResume && !payload.data.challengeRequired;
      ignorePlayerErrorUntil.current = Date.now() + 5_000;
      if (payload.data.challengeRequired && payload.data.challengeToken) {
        updateChallengeToken(payload.data.challengeToken);
        setChallengeSeconds(
          challengeRemainingSeconds(payload.data.challengeExpiresAt),
        );
        setChallengeOrigin(origin);
      } else {
        updateChallengeToken(null);
        setChallengeOrigin(payload.data.challengeTimedOut ? origin : null);
      }
      if (payload.data.challengeTimedOut) {
        setError(
          "上一個在席確認已逾時，該區塊不計入；請從原區塊起點重新觀看。",
        );
        applyChallengeTimeout(origin);
      }
      activeSessionId.current = payload.data.playbackSessionId;
      sessionRef.current = {
        ...payload.data,
        rewindToSeconds: targetPosition,
      };
      playbackAuthorized.current = true;
      setSession(sessionRef.current);
      if (!payload.data.challengeTimedOut) setError("");
      return true;
    } catch {
      setError(
        "目前無法更新安全播放連結，影片已停止且不會計時。請確認網路後重試。",
      );
      return false;
    } finally {
      refreshing.current = false;
    }
  }, [
    applyChallengeTimeout,
    applyRewindOriginRequired,
    challengeToken,
    enrollmentId,
    ensureHeartbeatQueue,
    lessonVideoVersionId,
    pausePlayer,
    session,
    updateChallengeToken,
  ]);

  useEffect(() => {
    if (!session) return;
    const delay = playbackTokenRefreshDelayMs(session.playbackExpiresAt);
    const timer = window.setTimeout(() => {
      void refreshPlayback();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [refreshPlayback, session]);

  const deliverHeartbeat = useCallback(
    async (
      snapshot: RecordedHeartbeatSnapshot,
      nextSequence: number,
    ): Promise<HeartbeatDeliveryResult> => {
      if (activeSessionId.current !== snapshot.playbackSessionId) {
        return "accepted";
      }
      let response: Response;
      try {
        response = await fetch("/api/playback/heartbeat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            enrollmentId: snapshot.enrollmentId,
            playbackSessionId: snapshot.playbackSessionId,
            leaseEpoch: snapshot.leaseEpoch,
            sequence: nextSequence,
            mediaPositionSeconds: snapshot.mediaPositionSeconds,
            playing: snapshot.playing,
            visible: snapshot.visible,
            online: snapshot.online,
            challengeToken: snapshot.challengeToken,
          }),
        });
      } catch {
        if (activeSessionId.current === snapshot.playbackSessionId) {
          playbackAuthorized.current = false;
          pausePlayer();
          setError(
            "觀看連線中斷，已停止播放與計時。請恢復網路後重新載入課程。",
          );
        }
        return "stop";
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: {
          challengeRequired?: boolean;
          challengeToken?: string;
          challengeTimedOut?: boolean;
          challengeExpiresAt?: string | null;
          originLessonId?: string | null;
          originVideoVersionId?: string | null;
          originPositionSeconds?: number | null;
          rewindToSeconds?: number;
        };
      } | null;
      if (activeSessionId.current !== snapshot.playbackSessionId) {
        return "accepted";
      }
      if (!response.ok) {
        playbackAuthorized.current = false;
        pausePlayer();
        setError("觀看資格或連線已失效，已停止計時。請重新載入課程後再開始。");
        return "stop";
      }
      const origin = payload?.data ? challengeOriginFrom(payload.data) : null;
      if (payload?.data?.challengeTimedOut) {
        ensureHeartbeatQueue().clearPending();
        updateChallengeToken(null);
        setChallengeOrigin(origin);
        setError("未在 90 秒內確認，這一區塊不計入；請從原區塊起點重新觀看。");
        applyChallengeTimeout(origin);
        return "accepted";
      }
      if (payload?.data?.challengeRequired && payload.data.challengeToken) {
        ensureHeartbeatQueue().clearPending();
        updateChallengeToken(payload.data.challengeToken);
        setChallengeSeconds(
          challengeRemainingSeconds(payload.data.challengeExpiresAt),
        );
        setChallengeOrigin(origin);
        pausePlayer();
      }
      if (typeof payload?.data?.rewindToSeconds === "number") {
        mediaPosition.current = payload.data.rewindToSeconds;
        if (player.current) {
          player.current.currentTime = payload.data.rewindToSeconds;
        }
      }
      return "accepted";
    },
    [
      applyChallengeTimeout,
      ensureHeartbeatQueue,
      pausePlayer,
      updateChallengeToken,
    ],
  );

  useEffect(() => {
    heartbeatDelivery.current = deliverHeartbeat;
  }, [deliverHeartbeat]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      enqueueHeartbeat();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [enqueueHeartbeat, session]);

  useEffect(() => {
    const reportVisibility = () => {
      enqueueHeartbeat({
        visible: document.visibilityState === "visible",
      });
    };
    const reportOnline = () => enqueueHeartbeat({ online: true });
    const reportOffline = () => enqueueHeartbeat({ online: false });
    document.addEventListener("visibilitychange", reportVisibility);
    window.addEventListener("online", reportOnline);
    window.addEventListener("offline", reportOffline);
    return () => {
      document.removeEventListener("visibilitychange", reportVisibility);
      window.removeEventListener("online", reportOnline);
      window.removeEventListener("offline", reportOffline);
    };
  }, [enqueueHeartbeat]);

  useEffect(
    () => () => {
      heartbeatQueue.current?.stop();
      sessionRef.current = null;
      activeSessionId.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!challengeToken) return;
    const timer = window.setTimeout(() => {
      if (challengeSeconds <= 1) {
        updateChallengeToken(null);
        setError("未在 90 秒內確認，這一區塊不計入；請從原區塊起點重新觀看。");
        applyChallengeTimeout(challengeOrigin);
      } else {
        setChallengeSeconds((seconds) => seconds - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    applyChallengeTimeout,
    challengeOrigin,
    challengeSeconds,
    challengeToken,
    updateChallengeToken,
  ]);

  async function confirmPresence() {
    if (!challengeToken) return;
    const idempotencyKey =
      challengeConfirmationKey.current ?? crypto.randomUUID();
    challengeConfirmationKey.current = idempotencyKey;
    let response: Response;
    try {
      response = await fetch("/api/playback/presence", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ enrollmentId, challengeToken }),
      });
    } catch {
      playbackAuthorized.current = false;
      pausePlayer();
      setError("確認連線中斷，這一段暫不計入；請恢復網路後重新驗證。");
      return;
    }
    if (!response.ok) {
      pausePlayer();
      setError("確認已逾時，這一段需要重新觀看。");
      applyChallengeTimeout(challengeOrigin);
    } else {
      updateChallengeToken(null);
      setChallengeOrigin(null);
      if (player.current) {
        if (!playbackAuthorized.current) return;
        player.current.playbackRate = 1;
        try {
          await player.current.play();
        } catch {
          setError("瀏覽器暫時阻擋播放，請按「1 倍速繼續播放」。");
        }
      }
      return;
    }
    updateChallengeToken(null);
  }

  if (!session) {
    return (
      <div className="classroom-start">
        <h2>準備開始錄播課</h2>
        <p>影片固定 1 倍速。背景分頁、暫停、斷線不會計入有效時間。</p>
        <button className="button" onClick={start}>
          驗證資格並開始
        </button>
        <p aria-live="polite">{error}</p>
      </div>
    );
  }

  const code = customerCode ? normalizedCustomerCode(customerCode) : "";

  return (
    <div className="video-shell">
      <div className="viewer-overlay">{session.overlay}</div>
      {code ? (
        <>
          <Stream
            key={session.playbackToken}
            controls={false}
            customerCode={code}
            muted={muted}
            onCanPlay={() => {
              if (!player.current) return;
              player.current.playbackRate = 1;
              if (!playbackAuthorized.current) return;
              if (resumeAfterRefresh.current && !challengeToken) {
                resumeAfterRefresh.current = false;
                void player.current.play().catch(() => {
                  setError("播放權限已更新，請按「1 倍速繼續播放」接續上課。");
                });
              }
            }}
            onEnded={() => {
              pausePlayer();
              enqueueHeartbeat({ playing: false });
            }}
            onError={() => {
              pausePlayer();
              if (Date.now() >= ignorePlayerErrorUntil.current) {
                void refreshPlayback();
              }
              setError("安全播放連結正在重新驗證，驗證完成前不會計時。");
            }}
            onPause={() => {
              pausePlayer();
              enqueueHeartbeat({ playing: false });
            }}
            onPlay={() => {
              if (player.current) player.current.playbackRate = 1;
              if (!playbackAuthorized.current) pausePlayer();
            }}
            onPlaying={() => {
              if (!playbackAuthorized.current) {
                pausePlayer();
                return;
              }
              if (player.current) player.current.playbackRate = 1;
              actuallyPlaying.current = true;
              setPlaying(true);
              enqueueHeartbeat({ playing: true });
            }}
            onRateChange={() => {
              if (player.current && player.current.playbackRate !== 1) {
                player.current.playbackRate = 1;
                setError("積分課程固定使用 1 倍速播放。");
              }
            }}
            onSeeking={() => {
              actuallyPlaying.current = false;
              setPlaying(false);
              if (player.current) {
                mediaPosition.current = player.current.currentTime;
              }
              enqueueHeartbeat({ playing: false });
            }}
            onTimeUpdate={() => {
              if (player.current) {
                mediaPosition.current = player.current.currentTime;
              }
            }}
            onWaiting={() => {
              actuallyPlaying.current = false;
              setPlaying(false);
              enqueueHeartbeat({ playing: false });
            }}
            playbackRate={1}
            preload="metadata"
            primaryColor="#EA880C"
            src={session.playbackToken}
            startTime={session.rewindToSeconds ?? session.resumeAtSeconds ?? 0}
            streamRef={player}
            title="歲悅學苑課程影片"
          />
          <div aria-label="影片控制" className="video-controls" role="group">
            <button className="button secondary" onClick={rewindPlayer}>
              倒退 15 秒
            </button>
            {playing ? (
              <button className="button" onClick={pausePlayer}>
                暫停
              </button>
            ) : (
              <button className="button" onClick={() => void resumePlayer()}>
                1 倍速繼續播放
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => {
                if (!player.current) return;
                player.current.muted = !muted;
                setMuted(!muted);
              }}
            >
              {muted ? "開啟聲音" : "靜音"}
            </button>
          </div>
        </>
      ) : (
        <div className="closed-note">Cloudflare 播放識別尚未設定。</div>
      )}
      <p>{session.capabilityNotice}</p>
      {challengeToken && (
        <div aria-modal="true" className="presence-dialog" role="dialog">
          <div>
            <p className="eyebrow">在席確認</p>
            <h2>你還在上課嗎？</h2>
            <p>請在 {challengeSeconds} 秒內按下確認，上一個區塊才會計入。</p>
            <button className="button" onClick={confirmPresence}>
              我還在上課
            </button>
          </div>
        </div>
      )}
      <p aria-live="polite">{error}</p>
    </div>
  );
}
