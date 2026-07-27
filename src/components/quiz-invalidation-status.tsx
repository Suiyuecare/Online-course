"use client";

import { useEffect, useState } from "react";
import {
  learnerQuizInvalidationStatusSchema,
  type LearnerQuizInvalidationStatus,
} from "@/application/quiz-attempt-invalidation";

const requestStatusLabels: Record<string, string> = {
  pending: "作廢審核中",
  pending_review: "作廢審核中",
  approved: "已核准作廢",
  rejected: "維持原成績",
};

export function QuizInvalidationStatus({
  enrollmentId,
}: {
  enrollmentId: string;
}) {
  const [statuses, setStatuses] =
    useState<LearnerQuizInvalidationStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/quiz/invalidation-status?enrollmentId=${encodeURIComponent(enrollmentId)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        const parsed = learnerQuizInvalidationStatusSchema.safeParse(
          result?.data,
        );
        if (!response.ok || !parsed.success) {
          throw new Error("QUIZ_INVALIDATION_STATUS_UNAVAILABLE");
        }
        setStatuses(parsed.data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setUnavailable(true);
      });
    return () => controller.abort();
  }, [enrollmentId]);

  if (unavailable) {
    return (
      <div className="warning-panel">
        <strong>測驗作廢狀態暫時無法顯示</strong>
        <p>系統不會因此把待審或已作廢的成績算成有效；請稍後重新整理確認。</p>
      </div>
    );
  }
  if (!statuses || statuses.length === 0) return null;

  return (
    <section className="single-step-form">
      <h2>測驗作廢狀態</h2>
      <p>這裡只顯示整次測驗的狀態，不會顯示題目、答案或工作人員資料。</p>
      {statuses.map((item) => (
        <div className="status-card status-warning" key={item.attemptId}>
          <strong>
            第 {item.attemptNumber} 次測驗：
            {requestStatusLabels[item.requestStatus ?? ""] ??
              (item.status === "voided" ? "已作廢" : "狀態確認中")}
          </strong>
          <p>
            成績：{item.score === null ? "未計分" : `${item.score} 分`}
            ；申請時間：
            {item.requestedAt
              ? new Date(item.requestedAt).toLocaleString("zh-TW")
              : "尚未提出"}
          </p>
          <p>{item.reason ?? "案件正在處理，完成覆核後會更新說明。"}</p>
          {(item.requestStatus === "approved" || item.status === "voided") && (
            <p>此成績不再作為完課依據；你可以重新完成一次測驗。</p>
          )}
        </div>
      ))}
    </section>
  );
}
