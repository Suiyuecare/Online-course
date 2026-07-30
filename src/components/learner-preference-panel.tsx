"use client";

import { useEffect, useState } from "react";

type Preferences = {
  highContrast: boolean;
  largeText: boolean;
  reduceMotion: boolean;
};

const initialPreferences: Preferences = {
  highContrast: false,
  largeText: false,
  reduceMotion: false,
};

export function LearnerPreferencePanel({ accountId }: { accountId: string }) {
  const key = `suiyue:learner-preferences:${accountId}:v1`;
  const [preferences, setPreferences] =
    useState<Preferences>(initialPreferences);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored: unknown = JSON.parse(
          window.localStorage.getItem(key) ?? "null",
        );
        if (stored && typeof stored === "object") {
          const value = stored as Partial<Preferences>;
          setPreferences({
            highContrast: value.highContrast === true,
            largeText: value.largeText === true,
            reduceMotion: value.reduceMotion === true,
          });
        }
      } catch {
        window.localStorage.removeItem(key);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "learner-pref-large-text",
      preferences.largeText,
    );
    document.documentElement.classList.toggle(
      "learner-pref-reduce-motion",
      preferences.reduceMotion,
    );
    document.documentElement.classList.toggle(
      "learner-pref-high-contrast",
      preferences.highContrast,
    );
  }, [preferences]);

  function update(next: Preferences) {
    setPreferences(next);
    window.localStorage.setItem(key, JSON.stringify(next));
  }

  return (
    <div className="learner-settings-list" aria-busy={!ready}>
      <label>
        <span>
          <strong>放大介面文字</strong>
          <small>讓課程資訊與按鈕更容易閱讀。</small>
        </span>
        <input
          checked={preferences.largeText}
          onChange={(event) =>
            update({ ...preferences, largeText: event.target.checked })
          }
          type="checkbox"
        />
      </label>
      <label>
        <span>
          <strong>減少動畫效果</strong>
          <small>降低滑動與轉場造成的不適。</small>
        </span>
        <input
          checked={preferences.reduceMotion}
          onChange={(event) =>
            update({ ...preferences, reduceMotion: event.target.checked })
          }
          type="checkbox"
        />
      </label>
      <label>
        <span>
          <strong>提高文字與邊界對比</strong>
          <small>加深文字、連結與表單邊線，讓重要操作更容易辨識。</small>
        </span>
        <input
          checked={preferences.highContrast}
          onChange={(event) =>
            update({ ...preferences, highContrast: event.target.checked })
          }
          type="checkbox"
        />
      </label>
      <p>這些閱讀偏好會保存在目前裝置，不會改變正式學習紀錄。</p>
    </div>
  );
}
