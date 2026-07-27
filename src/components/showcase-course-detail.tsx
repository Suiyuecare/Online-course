import Link from "next/link";
import type { ShowcaseCourse } from "@/content/showcase-courses";
import { YouTubeDemoPreview } from "@/components/youtube-demo-preview";

const deliveryLabels = {
  recorded: "錄播",
  live: "同步直播",
  hybrid: "錄播＋同步直播",
};

export function ShowcaseCourseDetail({ course }: { course: ShowcaseCourse }) {
  return (
    <>
      <section className="showcase-course-hero shell">
        <nav aria-label="麵包屑">
          <Link href="/courses">全部課程</Link>
          <span aria-hidden="true">／</span>
          <span>{course.category}</span>
        </nav>
        <div className="showcase-course-heading">
          <div>
            <div className="badge-row">
              <span className="status-badge demo">網站功能示範</span>
              <span className="status-badge">
                {deliveryLabels[course.deliveryType]}
              </span>
              <span className="status-badge">{course.category}</span>
            </div>
            <h1>{course.title}</h1>
            <p className="lead">{course.summary}</p>
            <div className="showcase-instructor-line">
              <span aria-hidden="true">歲</span>
              <div>
                <strong>{course.instructor.displayName}</strong>
                <small>{course.instructor.role}</small>
              </div>
            </div>
          </div>
          <aside className="showcase-availability">
            <span>示意價格</span>
            <strong>
              NT$ {course.displayPriceTwd.toLocaleString("zh-TW")}
            </strong>
            <p>{course.accreditationLabel}</p>
            <div className="closed-note">
              <strong>尚未開放報名</strong>
              <p>
                這門課用來展示網站版面與操作。正式師資、積分核定、教材及售價完成後才會開放。
              </p>
            </div>
            <Link className="button secondary" href="/courses">
              繼續看其他課程
            </Link>
          </aside>
        </div>
      </section>

      <section className="showcase-course-content shell">
        <div>
          <YouTubeDemoPreview
            publisher={course.youtubePublisher}
            title={course.youtubeTitle}
            youtubeId={course.youtubeId}
          />

          <div className="showcase-key-facts">
            <article>
              <span>課程形式</span>
              <strong>{deliveryLabels[course.deliveryType]}</strong>
            </article>
            <article>
              <span>預計總分鐘</span>
              <strong>{course.durationMinutes} 分鐘</strong>
            </article>
            <article>
              <span>課程單元</span>
              <strong>{course.lessonCount} 個單元</strong>
            </article>
            <article>
              <span>在席確認</span>
              <strong>每 10 分鐘</strong>
            </article>
          </div>

          <section className="detail-section">
            <p className="eyebrow">適合對象</p>
            <h2>這門課適合誰</h2>
            <div className="audience-chips">
              {course.audience.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>

          <section className="detail-section learning-objectives">
            <p className="eyebrow">學習重點</p>
            <h2>完成後，你會更有把握</h2>
            <ul>
              {course.learningObjectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </section>

          <section className="detail-section showcase-outline">
            <div>
              <p className="eyebrow">課程大綱</p>
              <h2>一步一步完成，不用自己猜進度</h2>
            </div>
            <ol>
              {course.modules.map((module, moduleIndex) => (
                <li key={module.title}>
                  <span>{String(moduleIndex + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{module.title}</h3>
                    <ul>
                      {module.lessons.map((lesson) => (
                        <li key={lesson}>
                          <span aria-hidden="true">▶</span>
                          {lesson}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="detail-section platform-proof">
            <div>
              <p className="eyebrow">平台學習機制</p>
              <h2>看的分鐘、測驗與完成條件都能說清楚</h2>
            </div>
            <div className="platform-proof-grid">
              <article>
                <span aria-hidden="true">10</span>
                <h3>分鐘在席確認</h3>
                <p>提示跳出時完成確認，系統才認列對應觀看區段。</p>
              </article>
              <article>
                <span aria-hidden="true">80</span>
                <h3>分測驗門檻</h3>
                <p>通過標準、補考與完成狀態都會在學習中心顯示。</p>
              </article>
              <article>
                <span aria-hidden="true">✓</span>
                <h3>成果分開呈現</h3>
                <p>平台完課證明與主管機關積分登錄狀態不會混在一起。</p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
