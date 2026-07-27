"use client";

import { useState } from "react";

export function CourseMaterialDownloadButton({
  materialId,
  title,
}: {
  materialId: string;
  title: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <div>
      <button
        className="button secondary"
        onClick={() => {
          setMessage("準備教材中…");
          void fetch(`/api/learner/materials/${materialId}/download`, {
            method: "POST",
          })
            .then(async (response) => {
              if (!response.ok) throw new Error("REJECTED");
              const disposition =
                response.headers.get("content-disposition") ?? "";
              const fileName =
                disposition.match(/filename="([^"]+)"/)?.[1] ??
                "suiyue-material";
              const objectUrl = URL.createObjectURL(await response.blob());
              const anchor = document.createElement("a");
              anchor.href = objectUrl;
              anchor.download = fileName;
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
              window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
              setMessage(`「${title}」已下載。`);
            })
            .catch(() =>
              setMessage("目前無法下載；請確認修課權限或稍後再試。"),
            );
        }}
        type="button"
      >
        下載「{title}」
      </button>
      <span aria-live="polite">{message}</span>
    </div>
  );
}
