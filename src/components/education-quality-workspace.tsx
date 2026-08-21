"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  EducationQualityCourse,
  EducationQualityWorkspace as EducationQualityWorkspaceData,
} from "@/domain/education-quality";
import {
  educationQualityStatusPresentation,
  safeGoogleFormUrl,
} from "@/domain/education-quality";
import { presentErrorCode } from "@/domain/presentation";

const deliveryLabels: Record<EducationQualityCourse["deliveryType"], string> = {
  recorded: "錄播課",
  live: "直播課",
  hybrid: "混合課",
};

const taipeiDateFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeZone: "Asia/Taipei",
});

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "REQUEST_REJECTED");
  return result?.data;
}

function formatTaipeiDate(value: string) {
  return taipeiDateFormatter.format(new Date(value));
}

function RegistrationSettingsForm({
  course,
  onDirtyChange,
}: {
  course: EducationQualityCourse;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [registrationMode, setRegistrationMode] = useState(
    course.registrationMode,
  );
  const [externalUrl, setExternalUrl] = useState(
    course.externalRegistrationUrl ?? "",
  );
  const [ctaLabel, setCtaLabel] = useState(course.registrationCtaLabel);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    course.registrationMode === "google_form"
      ? "學員按下報名按鈕後，會前往這份 Google 表單。"
      : "學員會使用歲悅學苑既有的站內購課流程。",
  );
  const previewUrl = safeGoogleFormUrl(externalUrl);

  useEffect(() => {
    if (!dirty) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventAccidentalExit);
    return () =>
      window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    onDirtyChange(true);
  }

  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const safeUrl =
          registrationMode === "google_form"
            ? safeGoogleFormUrl(externalUrl)
            : null;
        if (registrationMode === "google_form" && !safeUrl) {
          setMessage(
            "請貼上 forms.gle 或 docs.google.com/forms 的正式 HTTPS 表單網址。",
          );
          return;
        }

        setBusy(true);
        setMessage("正在儲存報名設定…");
        void post(
          `/api/staff/education/courses/${encodeURIComponent(
            course.courseVersionId,
          )}/registration`,
          {
            registrationMode,
            externalRegistrationUrl: safeUrl,
            registrationCtaLabel: String(
              form.get("registrationCtaLabel") ?? "",
            ),
          },
        )
          .then(() => {
            setDirty(false);
            onDirtyChange(false);
            setMessage("報名設定已儲存。送審時會與課程版本一起鎖定。");
            window.setTimeout(() => window.location.reload(), 450);
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "設定未儲存；請確認表單網址、草稿狀態與後台權限。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h3>報名方式</h3>
      <label>
        學員按下報名後
        <select
          value={registrationMode}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "internal" || mode === "google_form") {
              setRegistrationMode(mode);
              markDirty();
              setMessage(
                mode === "google_form"
                  ? "請貼上教學品管部管理的 Google 表單網址。"
                  : "學員會使用歲悅學苑既有的站內購課流程。",
              );
            }
          }}
        >
          <option value="internal">使用站內購課</option>
          <option value="google_form">前往 Google 表單</option>
        </select>
      </label>
      {registrationMode === "google_form" ? (
        <label>
          Google 表單網址
          <input
            inputMode="url"
            maxLength={2048}
            name="externalRegistrationUrl"
            onChange={(event) => {
              setExternalUrl(event.target.value);
              markDirty();
            }}
            placeholder="https://forms.gle/..."
            required
            type="url"
            value={externalUrl}
          />
        </label>
      ) : null}
      <label>
        報名按鈕文字
        <input
          maxLength={20}
          minLength={2}
          name="registrationCtaLabel"
          onChange={(event) => {
            setCtaLabel(event.target.value);
            markDirty();
          }}
          required
          value={ctaLabel}
        />
      </label>
      <div className="page-actions">
        <button className="button" disabled={busy} type="submit">
          {busy ? "儲存中…" : "儲存報名設定"}
        </button>
        {registrationMode === "google_form" && previewUrl ? (
          <a
            className="button secondary"
            href={previewUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            測試開啟表單
          </a>
        ) : null}
      </div>
      <p aria-live="polite">{message}</p>
    </form>
  );
}

function CourseItem({ course }: { course: EducationQualityCourse }) {
  const [busy, setBusy] = useState(false);
  const [registrationDirty, setRegistrationDirty] = useState(false);
  const [message, setMessage] = useState("");
  const status = educationQualityStatusPresentation[course.status];

  function submitForReview() {
    if (registrationDirty) {
      setMessage("請先按「儲存報名設定」，再預覽或送交執行長審核。");
      return;
    }
    if (
      !window.confirm(
        "確定已用學員視角預覽，並要送交執行長審核嗎？送審後暫時不能編輯。",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("正在檢查必填內容並送交執行長審核…");
    void post(
      `/api/staff/courses/${encodeURIComponent(course.courseVersionId)}/submit`,
      {
        reason:
          "教學品管已完成課程頁、報名設定及學員視角預覽，送請執行長審核。",
      },
    )
      .then(() => {
        setMessage("已送交執行長審核；核准前不會顯示在前台。");
        window.setTimeout(() => window.location.reload(), 450);
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "尚未送審；請回到完整編輯補齊封面、課綱、影片、題庫或必要核定資料。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <article className="single-step-form">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {deliveryLabels[course.deliveryType]}・版本 {course.version}
          </p>
          <h2>{course.title}</h2>
        </div>
        <span className={`status status-${status.tone}`}>{status.label}</span>
      </div>
      <p>{course.summary || "尚未填寫課程摘要。"}</p>
      <p>
        {status.description} 最近更新：{formatTaipeiDate(course.updatedAt)}；
        {course.hasCover ? "封面已設定。" : "封面尚未設定。"}
      </p>

      {course.canEdit && (
        <RegistrationSettingsForm
          course={course}
          onDirtyChange={setRegistrationDirty}
        />
      )}

      {registrationDirty && (
        <p className="closed-note">
          報名設定尚未儲存；請先儲存，才可離開、預覽或送審。
        </p>
      )}

      <div className="page-actions">
        {course.canEdit && (
          <Link
            aria-disabled={registrationDirty}
            className="button"
            href={`/staff/courses/editor?draft=${encodeURIComponent(
              course.courseVersionId,
            )}`}
            onClick={(event) => {
              if (registrationDirty) {
                event.preventDefault();
                setMessage("請先儲存報名設定，再編輯其他課程內容。");
              }
            }}
          >
            編輯全部課程內容
          </Link>
        )}
        {course.canEdit && (
          <Link
            aria-disabled={registrationDirty}
            className="button secondary"
            href={`/staff/courses/editor?draft=${encodeURIComponent(
              course.courseVersionId,
            )}&preview=1#learner-preview`}
            onClick={(event) => {
              if (registrationDirty) {
                event.preventDefault();
                setMessage("請先儲存報名設定，再用學員視角預覽。");
              }
            }}
          >
            用學員視角預覽
          </Link>
        )}
        {course.canSubmit && (
          <button
            className="button"
            disabled={busy || registrationDirty}
            onClick={submitForReview}
            type="button"
          >
            {busy ? "送審中…" : "送交執行長審核"}
          </button>
        )}
        {course.status === "published" && (
          <Link className="button" href={`/courses/${course.slug}`}>
            查看前台課程頁
          </Link>
        )}
      </div>
      {course.status === "in_review" && (
        <p>需要修改時，請由審核者退回草稿；原課程與稽核紀錄都會保留。</p>
      )}
      <p aria-live="polite">{message}</p>
    </article>
  );
}

export function EducationQualityWorkspace({
  workspace,
}: {
  workspace: EducationQualityWorkspaceData;
}) {
  return (
    <div className="organization-tools">
      <section className="detail-grid" aria-label="課程上架三步驟">
        <article className="step-card">
          <span>步驟 1</span>
          <h2>建立與編輯</h2>
          <p>填寫課程介紹、課綱、封面、影片、測驗與上課規則。</p>
          <Link className="button" href="/staff/courses/editor">
            建立新課程
          </Link>
        </article>
        <article className="step-card">
          <span>步驟 2</span>
          <h2>設定報名</h2>
          <p>選擇站內購課，或指定教學品管部管理的 Google 表單。</p>
        </article>
        <article className="step-card">
          <span>步驟 3</span>
          <h2>預覽與送審</h2>
          <p>確認學員看到的內容，再送交執行長核准後正式上架。</p>
        </article>
      </section>

      <section aria-labelledby="education-course-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">課程清單</p>
            <h2 id="education-course-list-title">正在管理的課程</h2>
          </div>
          <span>{workspace.courses.length} 門</span>
        </div>
        {workspace.courses.length === 0 ? (
          <div className="single-step-form">
            <h3>還沒有課程</h3>
            <p>按「建立新課程」開始，草稿不會直接出現在前台。</p>
          </div>
        ) : (
          <div className="organization-tools">
            {workspace.courses.map((course) => (
              <CourseItem course={course} key={course.courseVersionId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
