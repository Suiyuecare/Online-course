"use client";

import { Stream } from "@cloudflare/stream-react";
import { useEffect, useState } from "react";

type PreviewSession = {
  previewToken: string;
  expiresAt: string;
  customerCode: string;
  lessonId: string;
};

function normalizedCustomerCode(value: string): string {
  return value
    .trim()
    .replace(/^https:\/\/customer-/i, "")
    .replace(/^customer-/i, "")
    .replace(/\.cloudflarestream\.com.*$/i, "");
}

export function CoursePreviewPlayer({
  courseVersionId,
  lessonId,
  lessonTitle,
}: {
  courseVersionId: string;
  lessonId: string;
  lessonTitle: string;
}) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(
      () => {
        setSession(null);
        setMessage("試看連結已到期，需要時請重新按一次免費試看。");
      },
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [session]);

  async function startPreview() {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/catalog/courses/${encodeURIComponent(courseVersionId)}/preview/${encodeURIComponent(lessonId)}`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        data?: Partial<PreviewSession>;
        message?: string;
      } | null;
      const candidate = payload?.data;
      const expiry = Date.parse(candidate?.expiresAt ?? "");
      if (
        !response.ok ||
        typeof candidate?.previewToken !== "string" ||
        !candidate.previewToken ||
        typeof candidate.customerCode !== "string" ||
        !normalizedCustomerCode(candidate.customerCode) ||
        candidate.lessonId !== lessonId ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        expiry > Date.now() + 6 * 60_000
      ) {
        setMessage(
          payload?.message ??
            "此試看片段目前無法播放，請稍後再試或聯絡歲悅學苑。",
        );
        return;
      }
      setSession(candidate as PreviewSession);
    } catch {
      setMessage("目前無法連線取得試看影片，請確認網路後再試。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="course-preview">
      {session ? (
        <Stream
          controls
          customerCode={normalizedCustomerCode(session.customerCode)}
          onError={() => {
            setSession(null);
            setMessage("安全試看連結已失效，請重新按免費試看。");
          }}
          preload="metadata"
          primaryColor="#EA880C"
          src={session.previewToken}
          title={`${lessonTitle}免費試看`}
        />
      ) : (
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void startPreview()}
          type="button"
        >
          {loading ? "正在開啟安全試看…" : "免費試看"}
        </button>
      )}
      <p aria-live="polite">{message}</p>
    </div>
  );
}
