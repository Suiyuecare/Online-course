"use client";

import { useEffect, useState } from "react";

type QuizQuestion = {
  itemId: string;
  prompt: string;
  topic: string;
  options: { id: string; text: string }[];
};

export function CompletionSteps({ enrollmentId }: { enrollmentId: string }) {
  const [quiz, setQuiz] = useState<{
    attemptId: string;
    expiresAt: string;
    questions: QuizQuestion[];
  } | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!quiz) return;
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.floor((Date.parse(quiz.expiresAt) - Date.now()) / 1000),
        ),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [quiz]);

  async function startQuiz() {
    const response = await fetch("/api/quiz/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ enrollmentId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage("目前不能開始測驗；請先確認課程權限與題庫狀態。");
      return;
    }
    setQuiz(result.data);
  }

  async function submitQuiz() {
    if (!quiz || Object.keys(responses).length !== 10) {
      setMessage("請完成全部 10 題後再送出。");
      return;
    }
    const response = await fetch("/api/quiz/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ attemptId: quiz.attemptId, responses }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage("測驗已逾 30 分鐘或答案無效，可重新開始一次測驗。");
      setQuiz(null);
      return;
    }
    setMessage(
      result.data.passed
        ? `成績 ${result.data.score} 分，已通過。`
        : `成績 ${result.data.score} 分；需加強：${result.data.topics.join("、")}。可不限次重考。`,
    );
    setQuiz(null);
    setResponses({});
  }

  return (
    <div className="completion-steps">
      <section className="single-step-form">
        <h2>課後測驗</h2>
        <p>每次隨機 10 題、30 分鐘、80 分及格，不限補考次數。</p>
        {!quiz ? (
          <button className="button secondary" onClick={startQuiz}>
            開始一次測驗
          </button>
        ) : (
          <>
            <strong>
              剩餘 {Math.floor(seconds / 60)}:
              {(seconds % 60).toString().padStart(2, "0")}
            </strong>
            {quiz.questions.map((question, index) => (
              <fieldset key={question.itemId}>
                <legend>
                  {index + 1}. {question.prompt}
                </legend>
                {question.options.map((option) => (
                  <label key={option.id}>
                    <input
                      type="radio"
                      name={question.itemId}
                      value={option.id}
                      checked={responses[question.itemId] === option.id}
                      onChange={() =>
                        setResponses((current) => ({
                          ...current,
                          [question.itemId]: option.id,
                        }))
                      }
                    />
                    {option.text}
                  </label>
                ))}
              </fieldset>
            ))}
            <button className="button" onClick={submitQuiz}>
              送出給伺服器評分
            </button>
          </>
        )}
      </section>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const ratings = [
            "content",
            "instructor",
            "platform",
            "practical",
            "overall",
          ].map((name) => Number(form.get(name)));
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
          }).then((response) =>
            setMessage(
              response.ok
                ? "滿意度已保存；24 小時內最多可修改一次。"
                : "滿意度尚未保存，請確認五題都已選擇。",
            ),
          );
        }}
      >
        <h2>滿意度</h2>
        {[
          ["content", "課程內容"],
          ["instructor", "講師"],
          ["platform", "平台"],
          ["practical", "實用性"],
          ["overall", "整體"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <select name={name} required defaultValue="">
              <option value="" disabled>
                請選擇 1～5
              </option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option value={rating} key={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          其他建議（選填）
          <textarea name="comment" maxLength={2000} />
        </label>
        <button className="button secondary" type="submit">
          送出滿意度
        </button>
      </form>
      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
