"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, UploadCloud } from "lucide-react";

export function AdminCourseSetup({
  courseId,
  lessonId,
  enabled,
}: {
  courseId: string;
  lessonId: string;
  enabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState("尚未上傳");
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024)
      return setState("檔案超過 200MB；第一階段請改用 TUS 上傳流程。");
    setBusy(true);
    setState("正在建立安全上傳網址…");
    try {
      const start = await fetch("/api/admin/stream/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId,
          filename: file.name,
          sizeBytes: file.size,
          durationSeconds: 360,
        }),
      });
      const result = await start.json();
      if (!start.ok) throw new Error(result.message ?? "無法建立上傳網址");
      setState("正在直接上傳到 Cloudflare Stream…");
      const form = new FormData();
      form.set("file", file);
      const uploaded = await fetch(result.uploadURL, {
        method: "POST",
        body: form,
      });
      if (!uploaded.ok) throw new Error("影片上傳失敗");
      setState(
        "上傳完成，Cloudflare 正在處理。完成後 webhook 會自動標記可播放。",
      );
    } catch (error) {
      setState(error instanceof Error ? error.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setState("正在檢查發布條件…");
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/publish`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "影片尚未 ready，不能發布");
      setState("課程已發布，可以進行真實測試付款。");
    } catch (error) {
      setState(error instanceof Error ? error.message : "發布失敗");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black text-[#B45309]">第一門測試課</p>
          <h2 className="mt-2 text-xl font-black text-[#302318]">
            失智照護入門：看見行為背後的需要
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            預期檔案：失智影片照護 中文字幕影片6min.mp4（約 33MB）
          </p>
        </div>
        <span className="rounded-full bg-[#FFF0D5] px-3 py-1.5 text-xs font-black text-[#8A4800]">
          draft → ready → published
        </span>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto_auto]">
        <label className="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-[#D7B98F] bg-[#FFF8ED] px-4">
          <UploadCloud className="size-5 text-[#B45309]" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-[#6F5E4E]">
            {file?.name ?? "選擇 200MB 以下 MP4"}
          </span>
          <input
            disabled={!enabled || busy}
            type="file"
            accept="video/mp4"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          disabled={!enabled || !file || busy}
          onClick={upload}
          className="button-primary"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <UploadCloud className="size-4" />
          )}
          上傳影片
        </button>
        <button
          disabled={!enabled || busy}
          onClick={publish}
          className="button-secondary"
        >
          <CheckCircle2 className="size-4" />
          發布課程
        </button>
      </div>
      <p
        role="status"
        className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-bold leading-6 text-slate-600"
      >
        狀態：{state}
      </p>
    </div>
  );
}
