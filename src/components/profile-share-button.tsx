"use client";

import { useState } from "react";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";

export function ProfileShareButton({
  path,
  title,
}: {
  path: string;
  title: string;
}) {
  const [message, setMessage] = useState("");

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setMessage("分享視窗已開啟");
      } else {
        await navigator.clipboard.writeText(url);
        setMessage("連結已複製");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("無法自動複製，請從瀏覽器網址列複製");
    }
  }

  return (
    <div className="profile-share-action">
      <button onClick={() => void share()} type="button">
        <LearnerPortalIcon name="share" size={20} />
        分享個人頁
      </button>
      <span aria-live="polite">{message}</span>
    </div>
  );
}
