"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  joinZoomMeeting,
  type ZoomJoinMaterial,
  type ZoomMeetingController,
} from "@/infrastructure/adapters/zoom-web";
import {
  clearTerminalLiveJoinAttempt,
  persistedLiveJoinAttemptId,
  type LiveJoinAttemptTerminalEvent,
} from "@/domain/live-join-attempt";
import {
  type HeartbeatDeliveryResult,
  SequentialHeartbeatQueue,
} from "@/domain/sequential-heartbeat";

type JoinResponse = ZoomJoinMaterial & {
  leaseId: string;
  lastHeartbeatSequence: number;
};
type PendingJoinAbort = {
  leaseId: string;
  reason: "sdk_join_failed" | "check_in_failed";
  idempotencyKey: string;
};
type LiveHeartbeatSnapshot = {
  leaseId: string;
  checkedDevice: boolean;
};

async function acceptedMutation(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    data?: { accepted?: boolean };
  } | null;
  return payload?.data?.accepted === true;
}

async function playSpeakerTone() {
  const AudioContextClass =
    window.AudioContext ??
    (
      window as Window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextClass) throw new Error("SPEAKER_TEST_UNAVAILABLE");
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.08, context.currentTime);
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.35);
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  await context.close();
}

export function ZoomClassroom({ liveSessionId }: { liveSessionId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<ZoomMeetingController | null>(null);
  const heartbeatTimer = useRef<number | null>(null);
  const joinLeaseId = useRef<string | null>(null);
  const joinAttemptId = useRef<string | null>(null);
  const heartbeatDelivery = useRef<
    (
      snapshot: LiveHeartbeatSnapshot,
      sequence: number,
    ) => Promise<HeartbeatDeliveryResult>
  >(async () => "stop");
  const heartbeatQueue =
    useRef<SequentialHeartbeatQueue<LiveHeartbeatSnapshot> | null>(null);
  const [message, setMessage] = useState(
    "加入前，請先測試喇叭，並允許瀏覽器使用相機與麥克風。",
  );
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [speakerTested, setSpeakerTested] = useState(false);
  const joinAttemptStorageKey = `suiyue:live-join-attempt:${liveSessionId}`;
  const deviceHashStorageKey = `${joinAttemptStorageKey}:device`;
  const pendingAbortStorageKey = `suiyue:live-join-abort:${liveSessionId}`;

  const ensureHeartbeatQueue = useCallback(() => {
    if (!heartbeatQueue.current) {
      heartbeatQueue.current =
        new SequentialHeartbeatQueue<LiveHeartbeatSnapshot>(
          0,
          (snapshot, nextSequence) =>
            heartbeatDelivery.current(snapshot, nextSequence),
        );
    }
    return heartbeatQueue.current;
  }, []);

  useEffect(
    () => () => {
      if (heartbeatTimer.current) {
        window.clearInterval(heartbeatTimer.current);
      }
      heartbeatQueue.current?.stop();
    },
    [],
  );

  async function testSpeaker() {
    try {
      await playSpeakerTone();
      setSpeakerTested(true);
      setMessage("喇叭測試音已播放；若有聽到聲音，就可以加入教室。");
    } catch {
      setSpeakerTested(false);
      setMessage("無法播放測試音。請檢查靜音模式與喇叭後再試。");
    }
  }

  function currentJoinAttemptId() {
    if (joinAttemptId.current) return joinAttemptId.current;
    joinAttemptId.current = persistedLiveJoinAttemptId(
      window.sessionStorage,
      joinAttemptStorageKey,
      () => crypto.randomUUID(),
    );
    return joinAttemptId.current;
  }

  function clearJoinAttempt(event: LiveJoinAttemptTerminalEvent) {
    joinAttemptId.current = null;
    clearTerminalLiveJoinAttempt(
      window.sessionStorage,
      [joinAttemptStorageKey, deviceHashStorageKey],
      event,
    );
  }

  async function currentDeviceHash() {
    const stored = window.sessionStorage.getItem(deviceHashStorageKey);
    if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
    const value = await crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          `${navigator.userAgent}|${screen.width}|${screen.height}|${crypto.randomUUID()}`,
        ),
      )
      .then((digest) =>
        [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      );
    window.sessionStorage.setItem(deviceHashStorageKey, value);
    return value;
  }

  const deliverHeartbeat = useCallback(
    async (
      snapshot: LiveHeartbeatSnapshot,
      nextSequence: number,
    ): Promise<HeartbeatDeliveryResult> => {
      if (joinLeaseId.current !== snapshot.leaseId) return "accepted";
      const activeController = controller.current;
      if (!activeController) return "stop";
      try {
        const heartbeat = await fetch("/api/live/heartbeat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            joinLeaseId: snapshot.leaseId,
            sequence: nextSequence,
            cameraOn: await activeController.cameraOn(),
            checkedDevice: snapshot.checkedDevice,
          }),
        });
        if (await acceptedMutation(heartbeat)) return "accepted";
      } catch {
        // A missing response is sequence-ambiguous. Stop this browser queue and
        // let a reload recover from the server's last accepted sequence.
      }
      if (joinLeaseId.current === snapshot.leaseId) {
        if (heartbeatTimer.current) {
          window.clearInterval(heartbeatTimer.current);
          heartbeatTimer.current = null;
        }
        setMessage(
          "出席回報已停止，現在不再累計。請保持教室開啟並重新載入頁面，系統會從伺服器最後一筆序號安全接續。",
        );
      }
      return "stop";
    },
    [],
  );

  useEffect(() => {
    heartbeatDelivery.current = deliverHeartbeat;
  }, [deliverHeartbeat]);

  function readPendingAbort(): PendingJoinAbort | null {
    try {
      const value = JSON.parse(
        window.sessionStorage.getItem(pendingAbortStorageKey) ?? "null",
      ) as Partial<PendingJoinAbort> | null;
      if (
        value &&
        typeof value.leaseId === "string" &&
        typeof value.idempotencyKey === "string" &&
        (value.reason === "sdk_join_failed" ||
          value.reason === "check_in_failed")
      ) {
        return value as PendingJoinAbort;
      }
    } catch {
      // Corrupt browser state is discarded and never sent to the server.
    }
    window.sessionStorage.removeItem(pendingAbortStorageKey);
    return null;
  }

  async function abortJoinAttempt(input: PendingJoinAbort) {
    window.sessionStorage.setItem(
      pendingAbortStorageKey,
      JSON.stringify(input),
    );
    const accepted = await fetch(`/api/live/${liveSessionId}/join/abort`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        leaseId: input.leaseId,
        reason: input.reason,
      }),
    })
      .then((response) => acceptedMutation(response))
      .catch(() => false);
    if (accepted) {
      window.sessionStorage.removeItem(pendingAbortStorageKey);
      clearJoinAttempt("abort_accepted");
    }
    return accepted;
  }

  async function join() {
    if (!root.current || !speakerTested) {
      setMessage("請先按「測試喇叭」，確認聽得到聲音後再加入。");
      return;
    }
    setBusy(true);
    const pendingAbort = readPendingAbort();
    if (pendingAbort) {
      const cleanupAccepted = await abortJoinAttempt(pendingAbort);
      setBusy(false);
      setMessage(
        cleanupAccepted
          ? "已接續處理上一次入場失敗。為避免重複出席，可能要等短效入場資格到期後才能重試。"
          : "上一次入場資格仍在安全清理中；請稍後重試或聯絡客服。",
      );
      return;
    }
    let checkedDevice = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      media.getTracks().forEach((track) => track.stop());
      checkedDevice = true;
    } catch {
      setBusy(false);
      setMessage("無法完成相機與麥克風測試。請允許權限後再加入。");
      return;
    }
    const deviceHash = await currentDeviceHash();
    let response: Response;
    try {
      response = await fetch(`/api/live/${liveSessionId}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": currentJoinAttemptId(),
        },
        body: JSON.stringify({ deviceHash }),
      });
    } catch {
      setBusy(false);
      setMessage("入場連線中斷，請按同一個按鈕安全重試。");
      return;
    }
    const result = (await response.json().catch(() => null)) as {
      data?: JoinResponse;
      error?: string;
    } | null;
    if (!response.ok || !result?.data) {
      if (result?.error === "LIVE_JOIN_ATTEMPT_EXPIRED") {
        clearJoinAttempt("lease_expired");
        setBusy(false);
        setMessage(
          "這次短效入場資格已到期。已清除舊請求；若舊連線仍未由 Zoom 確認離場，系統會繼續保守阻擋重複加入。",
        );
        return;
      }
      setBusy(false);
      setMessage("目前不能加入。請確認付款、場次、入場時間與設備狀態。");
      return;
    }
    const ephemeral = result.data;
    let failureStage: "sdk_join_failed" | "check_in_failed" = "sdk_join_failed";
    try {
      const joinedController = await joinZoomMeeting(root.current, ephemeral);
      controller.current = joinedController;
      joinLeaseId.current = ephemeral.leaseId;
      failureStage = "check_in_failed";
      const checkIn = await fetch(`/api/live/${liveSessionId}/check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          event: "check_in",
          deviceTestPassed: checkedDevice && speakerTested,
        }),
      });
      if (!(await acceptedMutation(checkIn))) {
        throw new Error("LIVE_CHECK_IN_REJECTED");
      }
      const queue = ensureHeartbeatQueue();
      queue.reset(ephemeral.lastHeartbeatSequence);
      setJoined(true);
      const heartbeatSnapshot = {
        leaseId: ephemeral.leaseId,
        checkedDevice: checkedDevice && speakerTested,
      };
      queue.enqueue(heartbeatSnapshot);
      if (heartbeatTimer.current) {
        window.clearInterval(heartbeatTimer.current);
      }
      heartbeatTimer.current = window.setInterval(() => {
        ensureHeartbeatQueue().enqueue(heartbeatSnapshot);
      }, 15_000);
      setMessage(
        `已加入同步教室（${joinedController.view === "client" ? "手機全頁模式" : "桌面元件模式"}）。鏡頭狀態是出席證據，不是人臉辨識。`,
      );
    } catch {
      heartbeatQueue.current?.stop();
      await controller.current?.leave().catch(() => undefined);
      controller.current = null;
      joinLeaseId.current = null;
      const aborted = await abortJoinAttempt({
        leaseId: ephemeral.leaseId,
        reason: failureStage,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(
        aborted
          ? "加入或簽到失敗，已開始清理本次入場資格。為避免重複出席，可能要等短效資格到期後才能重試。"
          : "加入或簽到失敗，入場資格仍在安全清理中；請稍後重試或聯絡客服。",
      );
    } finally {
      ephemeral.passcode = "";
      ephemeral.registrantToken = "";
      ephemeral.signature = "";
      setBusy(false);
    }
  }

  async function leave() {
    if (heartbeatTimer.current) {
      window.clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    heartbeatQueue.current?.stop();
    let checkOutAccepted = false;
    try {
      const checkOut = await fetch(`/api/live/${liveSessionId}/check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          event: "check_out",
          deviceTestPassed: speakerTested,
        }),
      });
      checkOutAccepted = await acceptedMutation(checkOut);
    } catch {
      checkOutAccepted = false;
    }
    await controller.current?.leave().catch(() => undefined);
    controller.current = null;
    joinLeaseId.current = null;
    setJoined(false);
    if (checkOutAccepted) {
      clearJoinAttempt("check_out_accepted");
    }
    setMessage(
      checkOutAccepted
        ? "已簽退並離開同步教室。"
        : "已離開教室，但簽退未被接受；請立即聯絡客服補正。",
    );
  }

  return (
    <div className="zoom-shell">
      <div className="zoom-instructions">
        <h2>進入同步教室</h2>
        <p aria-live="polite">{message}</p>
        <ul>
          <li>先完成喇叭、相機與麥克風測試。</li>
          <li>手機和平板使用 Zoom 全頁模式；桌面使用網站內元件模式。</li>
          <li>鏡頭與連線每 15 秒回報；中斷超過 45 秒停止累計。</li>
        </ul>
        <button className="button secondary" onClick={testSpeaker}>
          {speakerTested ? "重新測試喇叭" : "測試喇叭"}
        </button>
        <button className="button" disabled={busy || joined} onClick={join}>
          {busy ? "正在加入…" : "驗證資格並加入"}
        </button>
        {joined && (
          <button className="button secondary" onClick={leave}>
            簽退並離開
          </button>
        )}
      </div>
      <div className="zoom-root" ref={root} />
    </div>
  );
}
