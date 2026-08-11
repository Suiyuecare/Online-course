"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type StoryboardSlide = {
  alt: string;
  eyebrow: string;
  image: string;
  title: string;
};

export function LocalCourseStoryboard({
  compact = false,
  posterAlt,
  posterImage,
  title,
}: {
  compact?: boolean;
  posterAlt: string;
  posterImage: string;
  title: string;
}) {
  const slides = useMemo<StoryboardSlide[]>(
    () => [
      {
        alt: posterAlt,
        eyebrow: "課程情境",
        image: posterImage,
        title,
      },
      {
        alt: "照護工作者陪伴長者進行認知活動",
        eyebrow: "情境引導",
        image: "/images/suiyue-original/home-hero-care-activity.jpg",
        title: "從每天遇到的照護情境開始",
      },
      {
        alt: "長照團隊一起討論線上培訓內容",
        eyebrow: "帶回現場",
        image: "/images/suiyue-original/organization-training-team.jpg",
        title: "把學到的方法帶回照護團隊",
      },
    ],
    [posterAlt, posterImage, title],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [playing, slides.length]);

  const active = slides[activeIndex] ?? slides[0];

  return (
    <div
      aria-label={`${title}本站教材視覺導覽`}
      className={`local-course-storyboard${compact ? " is-compact" : ""}`}
      role="group"
    >
      <div className="local-course-storyboard-media">
        <Image
          alt={active.alt}
          fill
          key={active.image}
          loading={compact ? "eager" : undefined}
          priority={!compact}
          sizes={
            compact
              ? "(max-width: 760px) 100vw, 900px"
              : "(max-width: 900px) 100vw, 65vw"
          }
          src={active.image}
        />
        <div aria-hidden="true" className="local-course-storyboard-scrim" />
        <div className="local-course-storyboard-copy">
          <span>{active.eyebrow}</span>
          <strong>{active.title}</strong>
          <small>歲悅學苑本站自製視覺導覽</small>
        </div>
      </div>
      <div className="local-course-storyboard-controls">
        <button
          aria-label={playing ? "暫停教材視覺導覽" : "播放教材視覺導覽"}
          onClick={() => setPlaying((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
          {playing ? "暫停" : "播放"}
        </button>
        <div aria-label={`第 ${activeIndex + 1} 張，共 ${slides.length} 張`}>
          {slides.map((slide, index) => (
            <button
              aria-current={index === activeIndex ? "true" : undefined}
              aria-label={`查看第 ${index + 1} 張：${slide.title}`}
              key={slide.image}
              onClick={() => {
                setActiveIndex(index);
                setPlaying(false);
              }}
              type="button"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function LocalCourseDemoPreview({
  posterAlt,
  posterImage,
  referencePublisher,
  referenceTitle,
  referenceUrl,
  title,
}: {
  posterAlt: string;
  posterImage: string;
  referencePublisher: string;
  referenceTitle: string;
  referenceUrl: string;
  title: string;
}) {
  return (
    <div className="local-course-demo">
      <LocalCourseStoryboard
        posterAlt={posterAlt}
        posterImage={posterImage}
        title={title}
      />
      <div className="local-course-demo-note">
        <div>
          <strong>{title}</strong>
          <span>本站展示不需要載入 YouTube 或其他影音服務</span>
          <a href={referenceUrl} rel="noreferrer" target="_blank">
            延伸參考：{referenceTitle}（{referencePublisher}，新視窗）
          </a>
        </div>
        <p>
          這是歲悅自行製作的版面與播放控制導覽，不是正式教材，也不計入觀看分鐘、防掛機、測驗或長照積分。延伸參考連結只有在你主動點擊時才會離開本站。
        </p>
      </div>
    </div>
  );
}
