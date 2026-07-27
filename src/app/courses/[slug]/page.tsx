import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { CoursePreviewPlayer } from "@/components/course-preview-player";
import { RefundAllocationDisclosure } from "@/components/refund-allocation-disclosure";
import {
  catalogCourse,
  courseOutline,
  coursePurchaseReadiness,
} from "@/infrastructure/supabase/catalog";

function durationLabel(durationSeconds: number | null) {
  if (!durationSeconds) return "時間依單元內容";
  const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
  return `${minutes} 分鐘`;
}

function lessonTypeLabel(type: "video" | "material" | "quiz" | "survey") {
  return {
    video: "影片",
    material: "教材",
    quiz: "測驗",
    survey: "滿意度調查",
  }[type];
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await catalogCourse(slug);
  if (!course) notFound();
  const [readiness, outline] = await Promise.all([
    coursePurchaseReadiness(course.course_version_id),
    courseOutline(course.course_version_id),
  ]);
  return (
    <section className="page-shell shell course-detail">
      <div>
        <div className="course-detail-cover">
          {course.has_cover && (
            <Image
              alt={`${course.title}課程封面`}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 65vw"
              src={`/api/catalog/courses/${course.course_version_id}/cover`}
              unoptimized
            />
          )}
        </div>
        <p className="eyebrow">長照積分課程</p>
        <h1>{course.title}</h1>
        {course.accreditation_status === "applying" && (
          <div className="warning-panel">
            <strong>積分申請中、尚未核定，不保證取得點數</strong>
            <p>核准前不會開放正式內容、直播入場或核發積分證明。</p>
          </div>
        )}
        <p className="lead">{course.summary}</p>
        <p>{course.description}</p>
        <div className="detail-grid">
          <div>
            <span>課程形式</span>
            <strong>
              {course.delivery_type === "recorded"
                ? "錄播"
                : course.delivery_type === "live"
                  ? "同步直播"
                  : "錄播＋同步直播"}
            </strong>
          </div>
          <div>
            <span>含稅價格</span>
            <strong>NT$ {course.price_twd.toLocaleString("zh-TW")}</strong>
          </div>
          <div>
            <span>長照積分</span>
            <strong>
              {course.accreditation_points
                ? `${course.accreditation_points} 點`
                : "依核定結果"}
            </strong>
          </div>
        </div>
        <section>
          <h2>學習目標</h2>
          <ul>
            {course.learning_objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </section>
        <section className="public-course-outline">
          <h2>課程大綱</h2>
          <p>免費試看不需要登入；其餘付費單元購課後才會開放。</p>
          {outline.modules.length === 0 ? (
            <p>課綱目前整理中，完成後會在這裡公布。</p>
          ) : (
            <ol>
              {outline.modules.map((module) => (
                <li key={module.id}>
                  <h3>{module.title}</h3>
                  <p>本章影片約 {durationLabel(module.durationSeconds)}</p>
                  <ul>
                    {module.lessons.map((lesson, lessonIndex) => (
                      <li
                        key={
                          lesson.id ?? `${module.id}:paid-lesson:${lessonIndex}`
                        }
                      >
                        <div>
                          <strong>{lesson.title}</strong>
                          <span>
                            {lessonTypeLabel(lesson.type)}・
                            {durationLabel(lesson.durationSeconds)}・
                            {lesson.preview ? "可免費試看" : "付費單元"}
                          </span>
                        </div>
                        {lesson.preview && lesson.id && (
                          <CoursePreviewPlayer
                            courseVersionId={course.course_version_id}
                            lessonId={lesson.id}
                            lessonTitle={lesson.title}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>
        <RefundAllocationDisclosure course={course} />
        <section>
          <h2>講師</h2>
          {course.instructors.map((instructor) => (
            <article key={`${instructor.name}:${instructor.credentials}`}>
              <h3>{instructor.name}</h3>
              <p>{instructor.credentials}</p>
              <p>{instructor.biography}</p>
            </article>
          ))}
        </section>
        {course.live_sessions.length > 0 && (
          <section>
            <h2>同步直播場次</h2>
            <ul>
              {course.live_sessions.map((session) => (
                <li key={session.id}>
                  {session.title}：
                  {new Date(session.startsAt).toLocaleString("zh-TW", {
                    timeZone: "Asia/Taipei",
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}
        {course.equipment_requirements && (
          <section>
            <h2>設備需求</h2>
            <p>{course.equipment_requirements}</p>
          </section>
        )}
      </div>
      <aside className="purchase-card">
        <h2>報名前先知道</h2>
        <ol>
          <li>完整契約有 72 小時審閱期。</li>
          <li>第二次確認後才能建立匯款訂單。</li>
          <li>提交匯款資料不等於付款完成。</li>
          <li>實際入帳確認後才會開通。</li>
        </ol>
        {readiness.purchaseReady ? (
          <Link className="button" href={`/courses/${slug}/contract`}>
            開始契約審閱
          </Link>
        ) : (
          <div className="closed-note">
            <strong>目前暫不開放購買</strong>
            <ul>
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </section>
  );
}
