"use client";

import { useState } from "react";
import type { PlatformPrerequisiteOptions } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";

type LifecycleVersion =
  PlatformPrerequisiteOptions["courseLifecycleVersions"][number];
type LifecycleAction = "stop_sale" | "suspend" | "resume" | "archive";

const statusLabels: Record<LifecycleVersion["status"], string> = {
  published: "目前發布",
  suspended: "暫停販售",
  archived: "永久封存",
};

async function stepUp(courseVersionId: string) {
  const response = await fetch("/api/staff/step-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "course_publish",
      target: courseVersionId,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.data?.nonce) {
    throw new Error(result?.error ?? "FRESH_TOTP_STEP_UP_REQUIRED");
  }
  return result.data.nonce as string;
}

export function CourseLifecyclePanel({
  versions,
}: {
  versions: LifecycleVersion[];
}) {
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState(
    "停賣或暫停只影響新訂單；既有學員的課程版本與稽核紀錄不會被改寫。",
  );

  async function transition(
    version: LifecycleVersion,
    action: LifecycleAction,
    reason: string,
  ) {
    const confirmations: Record<LifecycleAction, string> = {
      stop_sale: "確定立即停止接受這個版本的新訂單？",
      suspend: "確定暫停這個版本？既有學員仍可依原權限上課。",
      resume: "確定重新公開這個版本？系統會重查法律與積分有效期。",
      archive: "確定永久封存這個版本？封存後不可重新公開。",
    };
    if (!window.confirm(confirmations[action])) return;
    setBusyId(version.id);
    setMessage("正在完成雙因素驗證與版本一致性檢查…");
    try {
      const nonce = await stepUp(version.id);
      const response = await fetch(
        `/api/staff/courses/${encodeURIComponent(version.id)}/lifecycle`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ action, reason, stepUpNonce: nonce }),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "COURSE_LIFECYCLE_REJECTED");
      }
      setMessage("版本狀態已更新，公開目錄與結帳會使用同一個正式版本。");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(
        presentErrorCode(
          error instanceof Error ? error.message : "",
          "操作未完成；請確認 TOTP、版本狀態、法律文件、積分期限與目前發布版本。",
        ),
      );
    } finally {
      setBusyId("");
    }
  }

  if (versions.length === 0) return null;
  return (
    <section className="single-step-form">
      <h2>正式版本販售與封存</h2>
      <p>
        同一門課只能有一個「目前發布」版本。新版發布前，先暫停舊版；封存只能從暫停狀態進行。
      </p>
      {versions.map((version) => (
        <form
          className="context-action-form"
          key={version.id}
          onSubmit={(event) => event.preventDefault()}
        >
          <strong>
            {version.title}（v{version.version}）－
            {statusLabels[version.status]}
          </strong>
          <small>
            /courses/{version.slug}；販售截止：
            {new Date(version.commerceCloseAt).toLocaleString("zh-TW")}
          </small>
          <label>
            操作原因（至少 10 字，會寫入不可覆寫稽核紀錄）
            <textarea
              name={`reason-${version.id}`}
              minLength={10}
              maxLength={1000}
              required
            />
          </label>
          <div className="page-actions">
            {(
              [
                ["stop_sale", "立即停賣", version.canStopSale],
                ["suspend", "暫停版本", version.canSuspend],
                ["resume", "重新公開", version.canResume],
                ["archive", "永久封存", version.canArchive],
              ] as const
            ).map(([action, label, enabled]) =>
              enabled ? (
                <button
                  className="button secondary"
                  disabled={Boolean(busyId)}
                  key={action}
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    const reason = String(
                      new FormData(form ?? undefined).get(
                        `reason-${version.id}`,
                      ) ?? "",
                    ).trim();
                    if (reason.length < 10) {
                      setMessage("請先填寫至少 10 個字的操作原因。");
                      return;
                    }
                    void transition(version, action, reason);
                  }}
                  type="button"
                >
                  {busyId === version.id ? "處理中…" : label}
                </button>
              ) : null,
            )}
          </div>
        </form>
      ))}
      <p aria-live="polite">{message}</p>
    </section>
  );
}
