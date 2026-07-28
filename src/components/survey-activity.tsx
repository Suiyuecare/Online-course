"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const surveyQuestions = [
  ["content", "課程內容清楚實用"],
  ["instructor", "講師說明容易理解"],
  ["platform", "網站操作順暢"],
  ["practical", "能運用在照護工作"],
  ["overall", "整體學習經驗良好"],
] as const;

export function SurveyActivity({
  enrollmentId,
  initiallyCompleted,
}: {
  enrollmentId: string;
  initiallyCompleted: boolean;
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [editing, setEditing] = useState(!initiallyCompleted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (completed && !editing) {
    return (
      <section className="course-runner-survey-complete">
        <span aria-hidden="true">✓</span>
        <div>
          <p className="eyebrow">滿意度已完成</p>
          <h2>謝謝你的回饋</h2>
          <p>系統已保存這項完課條件，並重新檢查證明產生資格。</p>
          <button
            className="button secondary"
            onClick={() => setEditing(true)}
            type="button"
          >
            修改回饋
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="course-runner-survey"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const ratings = surveyQuestions.map(([name]) => Number(form.get(name)));
        setBusy(true);
        setMessage("正在保存回饋…");
        void fetch("/api/surveys", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            enrollmentId,
            ratings,
            comment: String(form.get("comment") || "") || null,
          }),
        })
          .then((response) => {
            if (!response.ok) throw new Error("SURVEY_REJECTED");
            setCompleted(true);
            setEditing(false);
            setMessage("滿意度已保存。");
            router.refresh();
          })
          .catch(() => setMessage("滿意度尚未保存，請確認五題都已完成後再試。"))
          .finally(() => setBusy(false));
      }}
    >
      <div className="survey-scale-legend" aria-hidden="true">
        <span>1 不同意</span>
        <span>5 非常同意</span>
      </div>
      {surveyQuestions.map(([name, label], questionIndex) => (
        <fieldset key={name}>
          <legend>
            {questionIndex + 1}. {label}
          </legend>
          <div>
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating}>
                <input
                  defaultChecked={false}
                  name={name}
                  required
                  type="radio"
                  value={rating}
                />
                <span>{rating}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="survey-comment">
        其他建議（選填）
        <textarea
          maxLength={2000}
          name="comment"
          placeholder="例如：哪個單元最有幫助？還希望增加什麼內容？"
        />
      </label>
      <div className="page-actions">
        {completed && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setEditing(false)}
            type="button"
          >
            取消修改
          </button>
        )}
        <button className="button" disabled={busy} type="submit">
          {busy ? "保存中…" : completed ? "保存修改" : "送出滿意度"}
        </button>
      </div>
      <p aria-live="polite" className="flow-message">
        {message}
      </p>
    </form>
  );
}
