"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type QuizQuestion = {
  itemId: string;
  prompt: string;
  topic: string;
  options: { id: string; text: string }[];
};

type QuizAttempt = {
  attemptId: string;
  expiresAt: string;
  questions: QuizQuestion[];
};

type StoredQuizAttempt = {
  enrollmentId: string;
  quiz: QuizAttempt;
  responses: Record<string, string>;
  questionIndex: number;
};

function storageKey(enrollmentId: string): string {
  return `suiyue:quiz-draft:${enrollmentId}`;
}

function isStoredQuizAttempt(
  value: unknown,
  enrollmentId: string,
): value is StoredQuizAttempt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredQuizAttempt>;
  return (
    candidate.enrollmentId === enrollmentId &&
    typeof candidate.quiz?.attemptId === "string" &&
    typeof candidate.quiz.expiresAt === "string" &&
    Date.parse(candidate.quiz.expiresAt) > Date.now() &&
    Array.isArray(candidate.quiz.questions) &&
    candidate.responses !== null &&
    typeof candidate.responses === "object" &&
    Number.isInteger(candidate.questionIndex)
  );
}

export function QuizActivity({
  enrollmentId,
  initiallyPassed,
}: {
  enrollmentId: string;
  initiallyPassed: boolean;
}) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizAttempt | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [passed, setPassed] = useState(initiallyPassed);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let restoreTimer: number | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey(enrollmentId));
      if (!raw) return;
      const stored: unknown = JSON.parse(raw);
      if (!isStoredQuizAttempt(stored, enrollmentId)) {
        window.localStorage.removeItem(storageKey(enrollmentId));
        return;
      }
      restoreTimer = window.setTimeout(() => {
        setQuiz(stored.quiz);
        setResponses(stored.responses);
        setQuestionIndex(
          Math.min(
            Math.max(stored.questionIndex, 0),
            stored.quiz.questions.length - 1,
          ),
        );
        setMessage("已恢復這台裝置上尚未交卷的測驗。");
      }, 0);
    } catch {
      window.localStorage.removeItem(storageKey(enrollmentId));
    }
    return () => {
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
    };
  }, [enrollmentId]);

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

  useEffect(() => {
    if (!quiz) return;
    const stored: StoredQuizAttempt = {
      enrollmentId,
      quiz,
      responses,
      questionIndex,
    };
    window.localStorage.setItem(
      storageKey(enrollmentId),
      JSON.stringify(stored),
    );
  }, [enrollmentId, questionIndex, quiz, responses]);

  async function startQuiz() {
    setBusy(true);
    setMessage("正在準備題目…");
    try {
      const response = await fetch("/api/quiz/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ enrollmentId }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: QuizAttempt;
      } | null;
      if (!response.ok || !result?.data?.questions?.length) {
        setMessage("目前不能開始測驗；請先完成前面的課程條件。");
        return;
      }
      setQuiz(result.data);
      setResponses({});
      setQuestionIndex(0);
      setMessage("題目已準備完成，答案會保存在這台裝置。");
    } catch {
      setMessage("目前無法連線取得題目，請確認網路後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function submitQuiz() {
    if (!quiz || Object.keys(responses).length !== quiz.questions.length) {
      setMessage("還有題目尚未作答，請完成全部題目後再交卷。");
      return;
    }
    if (!window.confirm("確定要交卷嗎？送出後不能修改這次答案。")) return;
    setBusy(true);
    setMessage("正在送出並計算成績…");
    try {
      const response = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ attemptId: quiz.attemptId, responses }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: { passed: boolean; score: number; topics: string[] };
      } | null;
      if (!response.ok || !result?.data) {
        setMessage("測驗可能已逾時，請重新開始一次測驗。");
        setQuiz(null);
        window.localStorage.removeItem(storageKey(enrollmentId));
        return;
      }
      const { score, topics } = result.data;
      setPassed(result.data.passed);
      setMessage(
        result.data.passed
          ? `成績 ${score} 分，已通過課後測驗。`
          : `成績 ${score} 分；建議加強：${topics.join("、") || "課程重點"}。可以再次補考。`,
      );
      setQuiz(null);
      setResponses({});
      setQuestionIndex(0);
      window.localStorage.removeItem(storageKey(enrollmentId));
      router.refresh();
    } catch {
      setMessage("送出時網路中斷，答案仍保存在這台裝置，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  if (!quiz) {
    return (
      <section className="course-runner-quiz-card">
        <div className="quiz-intro-mark" aria-hidden="true">
          {passed ? "✓" : "80"}
        </div>
        <div>
          <p className="eyebrow">{passed ? "測驗已通過" : "課後測驗"}</p>
          <h2>{passed ? "你已完成這項任務" : "準備好再開始，限時 30 分鐘"}</h2>
          <p>
            每次由伺服器隨機抽出 10
            題。未通過可以不限次數補考，系統只保存正式作答紀錄。
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => void startQuiz()}
            type="button"
          >
            {passed ? "再次練習" : busy ? "準備中…" : "開始測驗"}
          </button>
          <p aria-live="polite" className="flow-message">
            {message}
          </p>
        </div>
      </section>
    );
  }

  const question = quiz.questions[questionIndex]!;
  const answeredCount = Object.keys(responses).length;
  const quizProgress = Math.round(
    ((questionIndex + 1) / quiz.questions.length) * 100,
  );

  return (
    <section className="course-runner-quiz">
      <header>
        <div>
          <span>
            第 {questionIndex + 1}／{quiz.questions.length} 題
          </span>
          <strong>
            剩餘 {Math.floor(seconds / 60)}:
            {(seconds % 60).toString().padStart(2, "0")}
          </strong>
        </div>
        <div
          aria-label={`測驗進度 ${quizProgress}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={quizProgress}
          className="quiz-progress-track"
          role="progressbar"
        >
          <span style={{ width: `${quizProgress}%` }} />
        </div>
        <small>已作答 {answeredCount} 題，答案會自動保存在這台裝置</small>
      </header>

      <fieldset>
        <legend>{question.prompt}</legend>
        {question.options.map((option, index) => (
          <label
            className={
              responses[question.itemId] === option.id ? "is-selected" : ""
            }
            key={option.id}
          >
            <input
              checked={responses[question.itemId] === option.id}
              name={question.itemId}
              onChange={() =>
                setResponses((current) => ({
                  ...current,
                  [question.itemId]: option.id,
                }))
              }
              type="radio"
              value={option.id}
            />
            <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>
            <strong>{option.text}</strong>
          </label>
        ))}
      </fieldset>

      <footer>
        <button
          className="button secondary"
          disabled={questionIndex === 0 || busy}
          onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
          type="button"
        >
          上一題
        </button>
        {questionIndex < quiz.questions.length - 1 ? (
          <button
            className="button"
            disabled={!responses[question.itemId] || busy}
            onClick={() =>
              setQuestionIndex((index) =>
                Math.min(quiz.questions.length - 1, index + 1),
              )
            }
            type="button"
          >
            下一題
          </button>
        ) : (
          <button
            className="button"
            disabled={
              answeredCount !== quiz.questions.length || busy || seconds === 0
            }
            onClick={() => void submitQuiz()}
            type="button"
          >
            {busy ? "交卷中…" : "確認交卷"}
          </button>
        )}
      </footer>
      <p aria-live="polite" className="flow-message">
        {seconds === 0 ? "作答時間已結束，請重新開始測驗。" : message}
      </p>
    </section>
  );
}
