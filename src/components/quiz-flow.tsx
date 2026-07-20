"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RotateCcw, Star } from "lucide-react";
import type { Course } from "@/lib/data";

type Question = {
  id: string;
  prompt: string;
  quiz_options: { id: string; label: string }[];
};
export function QuizFlow({
  course,
  liveSessionId,
}: {
  course: Course;
  liveSessionId?: string;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{
    score: number;
    passed: boolean;
    completion?: { completed?: boolean; verificationCode?: string };
  } | null>(null);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/quiz/${course.slug}${liveSessionId ? `?session=${liveSessionId}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setQuestions(data.questions);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setMessage("請先完成購課並登入，才能進行測驗。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [course.slug, liveSessionId]);
  async function submitQuiz() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/quiz/${course.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          liveSessionId,
          answers: Object.entries(answers).map(([questionId, optionId]) => ({
            questionId,
            optionId,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
      if (data.completion?.verificationCode)
        setCertificate(data.completion.verificationCode);
    } catch {
      setMessage("測驗送出失敗，請確認每一題都有作答。");
    } finally {
      setBusy(false);
    }
  }
  async function submitSatisfaction() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/satisfaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseSlug: course.slug,
          liveSessionId,
          rating,
          feedback,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (data.completion?.verificationCode) {
        setCertificate(data.completion.verificationCode);
        setMessage("全部條件完成，證明已產生。");
      } else if (data.completion?.certificatePending)
        setMessage("課程條件已完成，積分資料通過管理員驗證後會補發正式證明。");
      else
        setMessage(
          data.completion?.completed
            ? "課程條件已完成，系統正在產生證明。"
            : course.delivery === "live"
              ? "滿意度已儲存；出席審核通過後會自動產生證明。"
              : "滿意度已儲存；完成有效觀看時數後會自動產生證明。",
        );
    } catch {
      setMessage("滿意度送出失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-[#FFF8ED]">
        <LoaderCircle className="size-10 animate-spin text-[#B45309]" />
      </main>
    );
  const passScore = course.passScore ?? 80;
  return (
    <main className="min-h-screen bg-[#FFF8ED] py-8 sm:py-12">
      <div className="mx-auto w-[min(100%-1.25rem,760px)]">
        <Link href="/dashboard" className="text-sm font-black text-[#B45309]">
          ← 回到我的學習
        </Link>
        <div className="mt-5 rounded-3xl border border-[#EADFCF] bg-white p-6 shadow-xl sm:p-10">
          <p className="section-kicker">POST-COURSE QUIZ</p>
          <h1 className="mt-3 text-3xl font-black text-[#302318]">課後測驗</h1>
          <p className="mt-2 text-slate-500">
            共 {questions.length} 題，{passScore} 分及格；未通過可再次作答。
          </p>
          {!result && (
            <div className="mt-8 space-y-8">
              {questions.map((question, index) => (
                <fieldset key={question.id}>
                  <legend className="font-black leading-7 text-[#302318]">
                    {index + 1}. {question.prompt}
                  </legend>
                  <div className="mt-3 grid gap-2">
                    {question.quiz_options.map((option) => (
                      <label
                        key={option.id}
                        className={`flex min-h-13 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-bold ${answers[question.id] === option.id ? "border-[#EA880C] bg-[#FFF8ED] text-[#694115]" : "border-[#EADFCF] text-slate-600"}`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.id}
                          checked={answers[question.id] === option.id}
                          onChange={() =>
                            setAnswers((value) => ({
                              ...value,
                              [question.id]: option.id,
                            }))
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <button
                disabled={
                  busy || Object.keys(answers).length !== questions.length
                }
                onClick={submitQuiz}
                className="button-primary button-large w-full"
              >
                {busy ? "正在計分…" : "送出測驗"}
              </button>
            </div>
          )}
          {result && (
            <section className="mt-8 text-center">
              <span
                className={`mx-auto grid size-20 place-items-center rounded-full text-2xl font-black ${result.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
              >
                {result.score}
              </span>
              <h2 className="mt-5 text-2xl font-black text-[#302318]">
                {result.passed ? "測驗通過！" : "還差一點，再試一次"}
              </h2>
              <p className="mt-2 text-slate-500">
                及格標準 {passScore} 分，本次成績 {result.score} 分。
              </p>
              {!result.passed && (
                <button
                  onClick={() => {
                    setResult(null);
                    setAnswers({});
                  }}
                  className="button-secondary mt-5"
                >
                  <RotateCcw className="size-4" />
                  重新作答
                </button>
              )}
            </section>
          )}
          {result?.passed && (
            <section className="mt-10 border-t border-[#F0E7DB] pt-8">
              <h2 className="text-xl font-black text-[#302318]">
                完成滿意度調查
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                這是取得完課證明的必要條件。
              </p>
              <div className="mt-5 flex gap-2" aria-label="整體滿意度">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => setRating(value)}
                    aria-label={`${value} 分`}
                    className={`grid size-12 place-items-center rounded-xl border ${rating >= value ? "border-[#EA880C] bg-[#FFF8ED] text-[#EA880C]" : "border-[#EADFCF] text-slate-300"}`}
                  >
                    <Star
                      className="size-6"
                      fill={rating >= value ? "currentColor" : "none"}
                    />
                  </button>
                ))}
              </div>
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                className="field mt-4 min-h-28 resize-y"
                placeholder="有什麼想告訴歲悅團隊的嗎？（選填）"
              />
              <button
                disabled={busy || rating === 0}
                onClick={submitSatisfaction}
                className="button-primary mt-4 w-full"
              >
                <CheckCircle2 className="size-5" />
                送出滿意度
              </button>
            </section>
          )}
          {message && (
            <p
              role="status"
              className="mt-5 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold leading-6 text-[#694115]"
            >
              {message}
            </p>
          )}
          {certificate && (
            <Link
              className="button-primary button-large mt-5 w-full"
              href={`/certificate/${certificate}`}
            >
              查看歲悅學苑{course.accredited ? "積分" : "完課"}證明
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
