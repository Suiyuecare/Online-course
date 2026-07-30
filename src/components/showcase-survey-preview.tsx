"use client";

import { useState } from "react";

const questions = ["課程內容清楚實用", "網站操作順暢"] as const;

export function ShowcaseSurveyPreview({
  completed,
  onComplete,
  onReset,
}: {
  completed: boolean;
  onComplete?: () => void;
  onReset?: () => void;
}) {
  const [ratings, setRatings] = useState<number[]>(questions.map(() => 0));

  if (completed) {
    return (
      <section
        aria-live="polite"
        className="course-runner-survey-complete showcase-survey-complete"
      >
        <span aria-hidden="true">✓</span>
        <div>
          <p className="eyebrow">示範填寫完成</p>
          <h2>謝謝你的回饋</h2>
          <p>正式課程會立即更新完課條件；公開示範不會保存這次選擇。</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setRatings(questions.map(() => 0));
            onReset?.();
          }}
          type="button"
        >
          重新示範
        </button>
      </section>
    );
  }

  return (
    <section className="course-runner-survey showcase-runner-survey">
      <div className="survey-scale-legend" aria-hidden="true">
        <span>1 不同意</span>
        <span>5 非常同意</span>
      </div>
      {questions.map((question, index) => (
        <fieldset key={question}>
          <legend>
            {index + 1}. {question}
          </legend>
          <div>
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating}>
                <input
                  checked={ratings[index] === rating}
                  name={`showcase-survey-${index}`}
                  onChange={() =>
                    setRatings((current) =>
                      current.map((value, ratingIndex) =>
                        ratingIndex === index ? rating : value,
                      ),
                    )
                  }
                  type="radio"
                />
                <span>{rating}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="page-actions">
        <button
          className="button"
          disabled={ratings.some((rating) => rating === 0)}
          onClick={() => {
            onComplete?.();
          }}
          type="button"
        >
          完成示範問卷
        </button>
      </div>
      <p className="flow-message">此為互動示範，不會送出或保存回饋。</p>
    </section>
  );
}
