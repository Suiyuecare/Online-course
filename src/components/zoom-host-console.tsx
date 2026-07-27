"use client";

import { useRef, useState } from "react";
import {
  joinZoomMeeting,
  type ZoomJoinMaterial,
  type ZoomMeetingController,
} from "@/infrastructure/adapters/zoom-web";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

type HostMaterial = ZoomJoinMaterial & {
  sdkKey: string;
  zak: string;
};

export function ZoomHostConsole({ liveSessionId }: { liveSessionId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<ZoomMeetingController | null>(null);
  const [message, setMessage] = useState(
    "主持人必須剛完成一次 TOTP 驗證，才能取得一次性加入材料。",
  );
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  async function join() {
    if (!root.current) return;
    setBusy(true);
    let material: HostMaterial | null = null;
    try {
      const nonce = await obtainStepUp("host_join", liveSessionId);
      const joinResponse = await fetch(
        `/api/staff/live/${liveSessionId}/host-join`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ stepUpNonce: nonce }),
        },
      );
      const result = (await joinResponse.json().catch(() => null)) as {
        data?: HostMaterial;
      } | null;
      if (!joinResponse.ok || !result?.data) {
        throw new Error("JOIN_REJECTED");
      }
      material = result.data;
      controller.current = await joinZoomMeeting(root.current, material);
      setJoined(true);
      setMessage(
        `主持人已加入（${controller.current.view === "client" ? "手機全頁模式" : "桌面元件模式"}）。ZAK、passcode 與 signature 已從元件狀態清除。`,
      );
    } catch {
      setMessage("主持人加入被拒絕；請重新完成 TOTP 並檢查排程與 Zoom 設定。");
    } finally {
      if (material) {
        material.passcode = "";
        material.zak = "";
        material.signature = "";
      }
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await controller.current?.leave();
      controller.current = null;
      setJoined(false);
      setMessage("主持人已離開隔離控制台。");
    } catch {
      setMessage("主持人離開失敗，請使用 Zoom 會議控制確認狀態。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="zoom-shell">
      <div className="zoom-instructions">
        <h2>隔離主持人控制台</h2>
        <p aria-live="polite">{message}</p>
        <button className="button" disabled={busy || joined} onClick={join}>
          {busy ? "驗證並加入中…" : "重新驗證 TOTP 並主持"}
        </button>
        {joined && (
          <button className="button secondary" disabled={busy} onClick={leave}>
            離開主持控制台
          </button>
        )}
      </div>
      <div className="zoom-root" ref={root} />
    </div>
  );
}
