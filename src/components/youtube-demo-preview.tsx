"use client";

import Image from "next/image";
import { useState } from "react";
import { youtubeThumbnail } from "@/content/showcase-courses";

export function YouTubeDemoPreview({
  youtubeId,
  title,
  publisher,
}: {
  youtubeId: string;
  title: string;
  publisher: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="youtube-demo">
      <div className="youtube-frame">
        {loaded ? (
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0`}
            title={title}
          />
        ) : (
          <>
            <Image
              alt={`${title}影片預覽`}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 65vw"
              src={youtubeThumbnail(youtubeId)}
            />
            <button onClick={() => setLoaded(true)} type="button">
              <span aria-hidden="true">▶</span>
              播放公開示範影片
            </button>
          </>
        )}
      </div>
      <div className="youtube-demo-note">
        <div>
          <strong>{title}</strong>
          <span>影片來源：{publisher}</span>
          <a
            href={`https://www.youtube.com/watch?v=${youtubeId}`}
            rel="noreferrer"
            target="_blank"
          >
            在 YouTube 開啟原始影片（新視窗）
          </a>
        </div>
        <p>
          這是 YouTube
          公開影音的版面與播放示範，不是本課正式教材，也不計入觀看分鐘、防掛機、測驗或長照積分。
        </p>
      </div>
    </div>
  );
}
