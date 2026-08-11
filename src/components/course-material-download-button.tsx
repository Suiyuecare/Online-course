"use client";

import { useEffect, useRef, useState } from "react";

const inlinePreviewMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const downloadableMimeTypes = new Set([
  ...inlinePreviewMimeTypes,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

type MaterialResource = {
  blob: Blob;
  fileName: string;
  mimeType: string;
};

type MaterialPreview = {
  mimeType: string;
  objectUrl: string;
};

type MaterialNotice = {
  message: string;
  tone: "error" | "status";
};

function normalizedMimeType(value: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function supportsInlineCourseMaterialPreview(mimeType: string): boolean {
  return inlinePreviewMimeTypes.has(normalizedMimeType(mimeType));
}

async function readMaterialResource(
  materialId: string,
  signal: AbortSignal,
): Promise<MaterialResource> {
  const response = await fetch(
    `/api/learner/materials/${encodeURIComponent(materialId)}/download`,
    {
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
      signal,
    },
  );
  if (!response.ok) throw new Error("COURSE_MATERIAL_REJECTED");

  const mimeType = normalizedMimeType(response.headers.get("content-type"));
  if (!downloadableMimeTypes.has(mimeType)) {
    throw new Error("COURSE_MATERIAL_TYPE_REJECTED");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    disposition.match(/filename="([^"]+)"/)?.[1] ?? "suiyue-material";
  return {
    blob: await response.blob(),
    fileName,
    mimeType,
  };
}

export function CourseMaterialDownloadButton({
  allowInlinePreview = false,
  materialId,
  title,
}: {
  allowInlinePreview?: boolean;
  materialId: string;
  title: string;
}) {
  const [busyAction, setBusyAction] = useState<"download" | "preview" | null>(
    null,
  );
  const [notice, setNotice] = useState<MaterialNotice | null>(null);
  const [preview, setPreview] = useState<MaterialPreview | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const downloadObjectUrlsRef = useRef(new Set<string>());
  const mountedRef = useRef(false);
  const noticeId = `material-notice-${materialId}`;
  const previewId = `material-preview-${materialId}`;

  useEffect(() => {
    mountedRef.current = true;
    const downloadObjectUrls = downloadObjectUrlsRef.current;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current?.abort();
      for (const objectUrl of downloadObjectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
      downloadObjectUrls.clear();
    };
  }, []);

  const previewObjectUrl = preview?.objectUrl ?? null;
  useEffect(() => {
    if (!previewObjectUrl) return;
    return () => URL.revokeObjectURL(previewObjectUrl);
  }, [previewObjectUrl]);

  function scheduleDownload(resource: MaterialResource) {
    const objectUrl = URL.createObjectURL(resource.blob);
    downloadObjectUrlsRef.current.add(objectUrl);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = resource.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      if (downloadObjectUrlsRef.current.delete(objectUrl)) {
        URL.revokeObjectURL(objectUrl);
      }
    }, 1_000);
  }

  async function loadMaterial(action: "download" | "preview") {
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setBusyAction(action);
    setNotice({
      message: action === "preview" ? "正在安全開啟教材…" : "正在準備教材下載…",
      tone: "status",
    });

    try {
      const resource = await readMaterialResource(
        materialId,
        controller.signal,
      );
      if (!mountedRef.current) return;

      const canPreview = supportsInlineCourseMaterialPreview(resource.mimeType);
      setPreviewUnavailable(!canPreview);
      if (action === "preview") {
        if (!canPreview) {
          setPreview(null);
          setNotice({
            message:
              "這份教材是試算表或 CSV，只提供受保護下載，不會在網頁內開啟。",
            tone: "status",
          });
          return;
        }
        setPreview({
          mimeType: resource.mimeType,
          objectUrl: URL.createObjectURL(resource.blob),
        });
        setNotice({
          message: `已在本頁安全開啟「${title}」。`,
          tone: "status",
        });
        return;
      }

      scheduleDownload(resource);
      setNotice({
        message: `「${title}」已下載。`,
        tone: "status",
      });
    } catch (error) {
      if (
        !mountedRef.current ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      setNotice({
        message: "目前無法取得教材；請確認修課權限或稍後再試。",
        tone: "error",
      });
    } finally {
      if (mountedRef.current && activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setBusyAction(null);
      }
    }
  }

  return (
    <div aria-busy={busyAction !== null} className="course-material-access">
      <div className="course-material-actions">
        {allowInlinePreview && !previewUnavailable ? (
          <button
            aria-controls={previewId}
            aria-describedby={noticeId}
            className="button"
            disabled={busyAction !== null}
            onClick={() => void loadMaterial("preview")}
            type="button"
          >
            {busyAction === "preview"
              ? "正在開啟…"
              : preview
                ? "重新載入預覽"
                : "在教室內預覽"}
          </button>
        ) : null}
        <button
          aria-describedby={noticeId}
          className="button secondary"
          disabled={busyAction !== null}
          onClick={() => void loadMaterial("download")}
          type="button"
        >
          {busyAction === "download" ? "正在下載…" : `下載「${title}」`}
        </button>
      </div>
      <p
        aria-live={notice?.tone === "error" ? "assertive" : "polite"}
        className={`course-material-notice ${
          notice?.tone === "error" ? "is-error" : ""
        }`}
        id={noticeId}
        role={notice?.tone === "error" ? "alert" : "status"}
      >
        {notice?.message ?? "每次開啟或下載都會重新驗證修課權限。"}
      </p>
      {preview ? (
        <section
          aria-label={`「${title}」教材預覽`}
          className="course-material-preview"
          id={previewId}
        >
          <header>
            <div>
              <span>受保護教材預覽</span>
              <strong>{title}</strong>
            </div>
            <button
              aria-label={`關閉「${title}」教材預覽`}
              onClick={() => {
                setPreview(null);
                setNotice({
                  message: `已關閉「${title}」預覽。`,
                  tone: "status",
                });
              }}
              type="button"
            >
              關閉
            </button>
          </header>
          <iframe
            referrerPolicy="no-referrer"
            sandbox=""
            src={preview.objectUrl}
            title={`預覽教材「${title}」`}
          />
          <p>
            {preview.mimeType === "application/pdf"
              ? "PDF 預覽只在這個頁面暫時存在。"
              : "圖片預覽只在這個頁面暫時存在。"}
            關閉預覽或離開頁面後，瀏覽器會撤銷暫存網址。
          </p>
        </section>
      ) : null}
    </div>
  );
}
