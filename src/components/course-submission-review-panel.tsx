"use client";

import Image from "next/image";
import { useState } from "react";
import type { CourseSubmissionReview } from "@/application/admin-review-workflows";
import { safeGoogleFormUrl } from "@/domain/education-quality";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

export function CourseSubmissionReviewPanel({
  review,
  canPublish,
}: {
  review: CourseSubmissionReview;
  canPublish: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    canPublish
      ? "請先核對課程名稱、送審說明與實際報名頁，再決定是否核准上架。"
      : review.canDecide
        ? "退回與駁回都會保留課綱、單元、題庫、素材與核定連結，課程回到草稿後可修正再送審。"
        : "送審者不能審核自己的課程；最後上架必須由執行長／平台管理員核准。",
  );
  const externalRegistrationUrl =
    review.registrationMode === "google_form"
      ? safeGoogleFormUrl(review.externalRegistrationUrl)
      : null;
  const coverFailed = failedCoverId === review.courseVersionId;

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
        <div>
          <dt>報名方式</dt>
          <dd>
            {review.registrationMode === "google_form"
              ? "Google 表單"
              : "歲悅站內報名"}
          </dd>
        </div>
        <div>
          <dt>前台按鈕文字</dt>
          <dd>{review.registrationCtaLabel}</dd>
        </div>
      </dl>
      <a className="button secondary" href="#course-review-learner-preview">
        預覽前台課程頁
      </a>
      <section
        className="review-course-preview"
        id="course-review-learner-preview"
      >
        <p className="eyebrow">學員畫面預覽・未對外公開</p>
        <div className="review-course-preview-cover">
          {review.hasCover && !coverFailed ? (
            <Image
              alt={`${review.title}課程封面`}
              fill
              onError={() => setFailedCoverId(review.courseVersionId)}
              sizes="(max-width: 900px) 100vw, 45vw"
              src={`/api/staff/courses/${review.courseVersionId}/cover`}
              unoptimized
            />
          ) : (
            <span>
              {review.hasCover ? "封面預覽載入失敗" : "尚未設定課程封面"}
            </span>
          )}
        </div>
        <p>
          {review.deliveryType === "recorded"
            ? "錄播"
            : review.deliveryType === "live"
              ? "同步直播"
              : "錄播＋同步直播"}
        </p>
        <h4>{review.title}</h4>
        <p className="lead">{review.summary}</p>
        <p>{review.description}</p>
        <h5>學習目標</h5>
        <ul>
          {review.learningObjectives.map((objective, index) => (
            <li key={`${index}:${objective}`}>{objective}</li>
          ))}
        </ul>
        <h5>講師</h5>
        {review.instructors.map((instructor, index) => (
          <div key={`${index}:${instructor.name}:${instructor.credentials}`}>
            <strong>{instructor.name}</strong>
            <p>
              {instructor.credentials}・{instructor.biography}
            </p>
          </div>
        ))}
        <p className="closed-note">
          這是審核專用預覽；按下核准上架前，前台學員看不到這門課。
        </p>
      </section>
      {review.registrationMode === "google_form" && (
        <div className="warning-panel">
          <strong>上架前請實際檢查 Google 報名表單</strong>
          <p>
            請確認表單可開啟、課程名稱與日期正確、必填欄位完整，並確認回覆通知由教學品管部收到。
          </p>
          {externalRegistrationUrl ? (
            <>
              <p>
                <strong>審核後將公開的網址：</strong>
                <br />
                <code>{externalRegistrationUrl}</code>
              </p>
              <a
                className="button secondary"
                href={externalRegistrationUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                開啟 Google 報名表單檢查
              </a>
            </>
          ) : (
            <p role="alert">
              報名連結不符合安全規則，不能核准上架；請先退回教學品管部修正。
            </p>
          )}
        </div>
      )}
      {canPublish &&
        (review.registrationMode !== "google_form" ||
          externalRegistrationUrl) && (
          <form
            className="context-action-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const reason = String(form.get("reason") ?? "").trim();
              setBusy(true);
              setMessage("");
              void obtainStepUp("course_publish", review.courseVersionId)
                .then((stepUpNonce) =>
                  fetch(
                    `/api/staff/courses/${review.courseVersionId}/publish`,
                    {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "idempotency-key": crypto.randomUUID(),
                      },
                      body: JSON.stringify({ reason, stepUpNonce }),
                    },
                  ),
                )
                .then(async (response) => {
                  const result = await response.json().catch(() => null);
                  if (!response.ok) {
                    throw new Error(result?.error ?? "REQUEST_REJECTED");
                  }
                  return result;
                })
                .then(() => {
                  setMessage(
                    review.registrationMode === "google_form"
                      ? "Google 表單報名頁已核准並上架。"
                      : "課程已核准並上架。",
                  );
                  window.location.reload();
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      review.registrationMode === "google_form"
                        ? "尚未上架；請確認 Google 表單、獨立覆核資格與驗證器代碼。"
                        : "尚未上架；請確認正式課程檢核、獨立覆核資格與驗證器代碼。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <strong>
              {review.registrationMode === "google_form"
                ? "核准並上架 Google 表單報名頁"
                : "核准並上架課程"}
            </strong>
            <label>
              核准理由（至少 10 字）
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button primary" disabled={busy} type="submit">
              {busy ? "驗證與上架中…" : "輸入驗證器代碼後核准並上架"}
            </button>
          </form>
        )}
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
