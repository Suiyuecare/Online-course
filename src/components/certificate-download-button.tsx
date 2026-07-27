"use client";

import { useState } from "react";

export function CertificateDownloadButton({
  certificateId,
}: {
  certificateId: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        className="button secondary"
        onClick={() => {
          void fetch(`/api/certificates/${certificateId}/download`, {
            method: "POST",
          })
            .then(async (response) => {
              if (!response.ok) throw new Error("REJECTED");
              const objectUrl = URL.createObjectURL(await response.blob());
              const anchor = document.createElement("a");
              anchor.href = objectUrl;
              anchor.download = `suiyue-certificate-${certificateId}.pdf`;
              anchor.click();
              URL.revokeObjectURL(objectUrl);
              setMessage("證明已下載。");
            })
            .catch(() =>
              setMessage("目前無法下載；證明可能尚未核發或已撤銷。"),
            );
        }}
      >
        下載 PDF 證明
      </button>
      <span aria-live="polite">{message}</span>
    </>
  );
}
