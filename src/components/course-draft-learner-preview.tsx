import Link from "next/link";
import type { PlatformPrerequisiteOptions } from "@/application/workspace";

type CourseDraft = PlatformPrerequisiteOptions["courseDrafts"][number];

const deliveryLabels = {
  recorded: "錄播課程",
  live: "同步直播",
  hybrid: "錄播＋直播",
} satisfies Record<CourseDraft["deliveryType"], string>;

const lessonTypeLabels = {
  video: "影片",
  material: "教材",
  quiz: "測驗",
  survey: "滿意度",
} as const;

function formatPrice(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function CourseDraftLearnerPreview({ draft }: { draft: CourseDraft }) {
  const recordedMinutes = Math.ceil(draft.metadata.requiredWatchSeconds / 60);

  return (
    <section
      aria-labelledby="course-draft-preview-title"
      className="course-draft-learner-preview"
      id="learner-preview"
    >
      <div className="course-preview-safety-banner">
        <strong>學員視角預覽</strong>
        <span>尚未發布、不接受購買，也不會建立觀看或學習紀錄。</span>
        <Link
          href={`/staff/courses/editor?draft=${encodeURIComponent(draft.id)}`}
        >
          關閉預覽
        </Link>
      </div>

      <div className="course-preview-hero">
        <div>
          <p className="eyebrow">歲悅學苑・長照積分課程</p>
          <div className="course-preview-tags" aria-label="課程標籤">
            <span>{deliveryLabels[draft.deliveryType]}</span>
            <span>
              {draft.metadata.accreditationRevisionId
                ? "積分資料已連結"
                : "積分資料待補"}
            </span>
          </div>
          <h2 id="course-draft-preview-title">{draft.metadata.title}</h2>
          <p className="course-preview-summary">{draft.metadata.summary}</p>
          <div className="course-preview-facts">
            <span>
              <small>課程形式</small>
              <strong>{deliveryLabels[draft.deliveryType]}</strong>
            </span>
            <span>
              <small>有效觀看</small>
              <strong>
                {recordedMinutes > 0 ? `${recordedMinutes} 分鐘` : "依直播出席"}
              </strong>
            </span>
            <span>
              <small>題庫</small>
              <strong>{draft.questions.length} 題</strong>
            </span>
          </div>
        </div>

        <aside className="course-preview-purchase-card">
          <small>個人售價</small>
          <strong>{formatPrice(draft.metadata.priceTwd)}</strong>
          <button className="button" disabled type="button">
            預覽模式無法購買
          </button>
          <p>發布後，學員會在這裡看到購買資格與退費配置。</p>
        </aside>
      </div>

      <div className="course-preview-content-grid">
        <article>
          <p className="eyebrow">課程介紹</p>
          <h3>這堂課會學到什麼</h3>
          <p className="course-preview-description">
            {draft.metadata.description}
          </p>
          <ul>
            {draft.metadata.learningObjectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </article>

        <article>
          <p className="eyebrow">課程單元</p>
          <h3>
            {draft.modules.length} 個章節・
            {draft.modules.reduce(
              (total, module) => total + module.lessons.length,
              0,
            )}{" "}
            個單元
          </h3>
          <ol className="course-preview-outline">
            {draft.modules.map((module) => (
              <li key={module.id}>
                <strong>{module.label}</strong>
                <ul>
                  {module.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <span>{lesson.label}</span>
                      <small>
                        {lessonTypeLabels[lesson.contentType]}
                        {lesson.preview ? "・可試看" : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}
