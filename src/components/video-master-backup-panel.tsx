"use client";

import { useState } from "react";
import type { VideoMasterBackupItem } from "@/application/video-backup-workspace";
import { presentErrorCode } from "@/domain/presentation";

const statusLabels: Record<VideoMasterBackupItem["status"], string> = {
  uploading: "上傳中",
  processing: "處理中",
  ready: "可播放",
  failed: "處理失敗",
};

async function verifyBackup(
  videoAssetId: string,
  input: { reference: string; sha256: string },
) {
  const response = await fetch(
    `/api/staff/stream/assets/${videoAssetId}/backup`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "VIDEO_MASTER_BACKUP_REJECTED");
  }
  return result?.data;
}

function BackupAssetCard({ item }: { item: VideoMasterBackupItem }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <article className="context-action-form">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{item.courseTitle}</p>
          <h3>{item.lessonTitle}</h3>
        </div>
        <span
          className={
            item.masterBackupVerified
              ? "status status-success"
              : "status status-warning"
          }
        >
          {item.masterBackupVerified ? "母檔已驗證" : "等待母檔"}
        </span>
      </div>
      <dl className="compact-data-list">
        <div>
          <dt>Stream 狀態</dt>
          <dd>{statusLabels[item.status]}</dd>
        </div>
        <div>
          <dt>Provider 可播放</dt>
          <dd>{item.providerReady ? "是" : "尚未"}</dd>
        </div>
        <div>
          <dt>備份驗證時間</dt>
          <dd>
            {item.backupVerifiedAt
              ? new Date(item.backupVerifiedAt).toLocaleString("zh-TW")
              : "尚未驗證"}
          </dd>
        </div>
      </dl>
      {item.masterBackupVerified ? (
        <p className="success-note">
          母檔已由備份服務驗證；Stream 也完成處理後，影片會自動進入可播放狀態。
        </p>
      ) : item.status === "failed" ? (
        <div className="warning-panel">
          Stream 處理已失敗，請先重新上傳影片；失敗資產不能用備份確認強制開通。
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("正在向獨立母檔備份服務驗證…");
            void verifyBackup(item.videoAssetId, {
              reference: String(form.get("reference") ?? "").trim(),
              sha256: String(form.get("sha256") ?? "")
                .trim()
                .toLowerCase(),
            })
              .then(() => {
                setMessage("母檔已驗證並綁定；正在重新讀取影片狀態。");
                window.location.reload();
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "母檔尚未確認；請檢查備份服務、不可變路徑與 SHA-256。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            備份服務的不可變參照
            <input
              name="reference"
              minLength={3}
              maxLength={1000}
              placeholder="由已設定的備份服務提供"
              required
            />
          </label>
          <label>
            母檔 SHA-256
            <input
              autoCapitalize="none"
              autoCorrect="off"
              name="sha256"
              pattern="[A-Fa-f0-9]{64}"
              placeholder="64 位十六進位校驗碼"
              required
              spellCheck={false}
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? "驗證中…" : "驗證並綁定母檔"}
          </button>
        </form>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function VideoMasterBackupPanel({
  items,
}: {
  items: VideoMasterBackupItem[];
}) {
  return (
    <section className="single-step-form">
      <h2>第六步：確認影音母檔備份</h2>
      <p>
        Stream 影片必須同時完成 Provider
        處理與獨立不可變母檔備份，才會成為可播放狀態。參照與 SHA-256
        會交由伺服器端備份服務再次驗證。
      </p>
      {items.length === 0 ? (
        <p className="closed-note">目前草稿沒有待檢查的影音資產。</p>
      ) : (
        <div className="record-grid">
          {items.map((item) => (
            <BackupAssetCard item={item} key={item.videoAssetId} />
          ))}
        </div>
      )}
    </section>
  );
}
