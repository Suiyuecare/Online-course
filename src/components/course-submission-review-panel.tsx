"use client";

import { useState } from "react";
import type { CourseSubmissionReview } from "@/application/admin-review-workflows";
import { presentErrorCode } from "@/domain/presentation";

export function CourseSubmissionReviewPanel({
  review,
}: {
  review: CourseSubmissionReview;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    review.canDecide
      ? "退回與駁回都會保留課綱、單元、題庫、素材與核定連結，課程回到草稿後可修正再送審。"
      : "送審者不能審核自己的課程；請由另一位積分審核員處理。",
  );

  return (
    <section
      className="staff-review-panel"
      aria-labelledby="course-review-title"
    >
      <p className="eyebrow">送審資料</p>
      <h3 id="course-review-title">
        {review.title}／版本 {review.version}
      </h3>
      <dl className="compact-data-list">
        <div>
          <dt>送審者</dt>
          <dd>{review.submittedBy}</dd>
        </div>
        <div>
          <dt>送審時間</dt>
          <dd>{new Date(review.submittedAt).toLocaleString("zh-TW")}</dd>
        </div>
        <div>
          <dt>送審說明</dt>
          <dd>{review.submissionReason ?? "未提供"}</dd>
        </div>
      </dl>
      {review.canDecide && (
        <form
          className="context-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("");
            void fetch(`/api/staff/courses/${review.courseVersionId}/review`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              },
              body: JSON.stringify({
                decision: form.get("decision"),
                reason: form.get("reason"),
              }),
            })
              .then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok) {
                  throw new Error(result?.error ?? "REQUEST_REJECTED");
                }
                return result;
              })
              .then(() => {
                setMessage("審核結果已保存；所有草稿內容均已保留。");
                window.location.reload();
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "審核結果未保存；請確認角色、案件狀態與獨立覆核限制。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            審核決定
            <select name="decision" defaultValue="" required>
              <option value="" disabled>
                請選擇
              </option>
              <option value="return_for_correction">退回補正</option>
              <option value="reject">駁回此次送審</option>
            </select>
          </label>
          <label>
            具體理由（至少 10 字）
            <textarea name="reason" minLength={10} maxLength={1000} required />
          </label>
          <button className="button secondary" disabled={busy} type="submit">
            {busy ? "保存中…" : "保存審核決定"}
          </button>
        </form>
      )}
      <p aria-live="polite">{message}</p>
    </section>
  );
}
