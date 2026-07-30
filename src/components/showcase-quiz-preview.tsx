"use client";

import { useState } from "react";

const questions = [
  {
    prompt: "遇到失智長者重複詢問相同問題時，較適合的第一步是？",
    options: [
      "立即糾正並要求記住答案",
      "先回應情緒與需求，再用簡短語句說明",
      "完全不回應，等待行為停止",
      "請其他住民代為處理",
    ],
    answer: 1,
  },
  {
    prompt: "協助長者進食時出現持續咳嗽，較安全的做法是？",
    options: [
      "加快餵食速度",
      "立即讓長者平躺",
      "先停止餵食並觀察呼吸與意識",
      "改用吸管繼續餵食",
    ],
    answer: 2,
  },
  {
    prompt: "照護紀錄最重要的原則是？",
    options: [
      "記錄實際觀察、處置與時間",
      "只寫推測的原因",
      "等月底再一起補寫",
      "用其他服務對象的紀錄複製",
    ],
    answer: 0,
  },
  {
    prompt: "執行移位前，第一個應確認的項目是？",
    options: [
      "房間是否有音樂",
      "長者今天穿什麼顏色",
      "是否已經用餐",
      "長者能力、環境與輔具是否安全",
    ],
    answer: 3,
  },
  {
    prompt: "發現服務對象狀況與平常不同時，較適合怎麼做？",
    options: [
      "先等下一班再說",
      "依流程立即觀察、記錄並回報",
      "在社群公開詢問",
      "自行更改醫囑",
    ],
    answer: 1,
  },
] as const;

export function ShowcaseQuizPreview({
  onComplete,
  onReset,
  score,
}: {
  onComplete?: (score: number) => void;
  onReset?: () => void;
  score: number | null;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    questions.map(() => null),
  );
  const question = questions[questionIndex]!;
  const answer = answers[questionIndex];

  function finish() {
    const correct = answers.reduce<number>(
      (total, selected, index) =>
        total + (selected === questions[index]!.answer ? 1 : 0),
      0,
    );
    const nextScore = Math.round((correct / questions.length) * 100);
    onComplete?.(nextScore);
  }

  function reset() {
    setQuestionIndex(0);
    setAnswers(questions.map(() => null));
    onReset?.();
  }

  if (score !== null) {
    return (
      <section
        aria-live="polite"
        className="course-runner-quiz-card showcase-quiz-result"
      >
        <span className="step-chip">示範測驗已完成</span>
        <strong className="showcase-quiz-score">{score} 分</strong>
        <h2>{score >= 80 ? "通過 80 分門檻" : "還差一點，再試一次"}</h2>
        <p>
          正式課程會由伺服器評分並保存每次作答；這份示範答案與成績不會寫入任何帳號。
        </p>
        <button className="button secondary" onClick={reset} type="button">
          重新示範測驗
        </button>
      </section>
    );
  }

  return (
    <section className="course-runner-quiz showcase-runner-quiz">
      <header>
        <div>
          <span>
            第 {questionIndex + 1}／{questions.length} 題
          </span>
          <strong>80 分及格</strong>
        </div>
        <div className="quiz-progress-track">
          <span
            style={{
              width: `${((questionIndex + 1) / questions.length) * 100}%`,
            }}
          />
        </div>
        <small>互動介面示範，不保存答案或成績</small>
      </header>
      <fieldset>
        <legend>{question.prompt}</legend>
        {question.options.map((label, index) => (
          <label className={answer === index ? "is-selected" : ""} key={label}>
            <input
              checked={answer === index}
              name={`showcase-question-${questionIndex}`}
              onChange={() =>
                setAnswers((current) =>
                  current.map((value, answerIndex) =>
                    answerIndex === questionIndex ? index : value,
                  ),
                )
              }
              type="radio"
            />
            <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>
            <strong>{label}</strong>
          </label>
        ))}
      </fieldset>
      <footer>
        <button
          className="button secondary"
          disabled={questionIndex === 0}
          onClick={() => setQuestionIndex((current) => current - 1)}
          type="button"
        >
          上一題
        </button>
        <button
          className="button"
          disabled={answer === null}
          onClick={() => {
            if (questionIndex === questions.length - 1) {
              finish();
            } else {
              setQuestionIndex((current) => current + 1);
            }
          }}
          type="button"
        >
          {questionIndex === questions.length - 1 ? "交卷看分數" : "下一題"}
        </button>
      </footer>
    </section>
  );
}
