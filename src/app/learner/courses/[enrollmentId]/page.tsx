import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { readLearnerWorkspaceWithSafeFallback } from "@/application/workspace";
import { AccreditationIdentitySection } from "@/components/accreditation-identity-section";
import { CertificateDownloadButton } from "@/components/certificate-download-button";
import { CompletionSteps } from "@/components/completion-steps";
import { CourseMaterialDownloadButton } from "@/components/course-material-download-button";
import { LiveBookingCard } from "@/components/live-booking-card";
import { QuizInvalidationStatus } from "@/components/quiz-invalidation-status";
import { RecordedClassroom } from "@/components/recorded-classroom";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function LearningPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const { enrollmentId } = await params;
  const selectedLessonId = (await searchParams).lesson;
  let result: Awaited<ReturnType<typeof readLearnerWorkspaceWithSafeFallback>> =
    null;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  try {
    result = await readLearnerWorkspaceWithSafeFallback(supabase, enrollmentId);
  } catch {
    return (
      <section className="page-shell shell">
        <p className="eyebrow">我的課程</p>
        <h1>目前無法讀取課程內容</h1>
        <div className="warning-panel">
          <strong>學習資料仍受保護</strong>
          <p>
            系統無法確認完整課程圖與你的權限，因此不會提供影片或直播連結。請稍後重新整理；已保存的有效分鐘不會由瀏覽器覆寫。
          </p>
        </div>
      </section>
    );
  }
  if (!result) notFound();
  const { workspace, projectionReady } = result;
  const lessons = workspace.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title })),
  );
  const selectedLesson =
    lessons.find(
      (lesson) =>
        lesson.id === selectedLessonId &&
        !lesson.locked &&
        lesson.videoVersionId,
    ) ??
    lessons.find(
      (lesson) => !lesson.completed && !lesson.locked && lesson.videoVersionId,
    ) ??
    lessons.find((lesson) => !lesson.locked && lesson.videoVersionId);
  const nextComponent = workspace.components.find(
    (component) => component.required && !component.completed,
  );
  const enrollmentStatus = presentStatus(
    "enrollment",
    workspace.enrollmentStatus,
  );
  return (
    <section className="classroom-page shell">
      <p className="eyebrow">我的課程</p>
      <h1>{workspace.courseTitle}</h1>
      <div className={`status-card status-${enrollmentStatus.tone}`}>
        <strong>{enrollmentStatus.label}</strong>
        <p>{enrollmentStatus.description}</p>
      </div>
      {!projectionReady && (
        <div className="warning-panel">
          <strong>部分進度資訊暫時無法顯示</strong>
          <p>
            錄播章節仍由你的個人權限讀取；教材下載、直播、混合先修、身分遮罩及逐單元完成狀態會在安全投影恢復後顯示，不會由瀏覽器自行推定或暴露私人檔案位置。
          </p>
        </div>
      )}
      <section className="next-step-card">
        <p className="eyebrow">現在只要做這一步</p>
        <h2>
          {selectedLesson
            ? `繼續：${selectedLesson.title}`
            : nextComponent
              ? `下一步：${nextComponent.title}`
              : workspace.liveBookings.length > 0
                ? "查看下一場同步直播"
                : "完成測驗與滿意度"}
        </h2>
        {selectedLesson?.resumeSeconds ? (
          <p>
            將從約 {Math.floor(selectedLesson.resumeSeconds / 60)} 分鐘處續播。
          </p>
        ) : null}
      </section>

      <div className="learning-workspace">
        <aside className="course-outline" aria-label="課程章節">
          <h2>課程內容</h2>
          {workspace.modules.length === 0 ? (
            <p>此課程沒有錄播單元。</p>
          ) : (
            workspace.modules.map((module) => (
              <section key={module.id}>
                <h3>{module.title}</h3>
                <ol>
                  {module.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      {lesson.videoVersionId && !lesson.locked ? (
                        <Link
                          aria-current={
                            selectedLesson?.id === lesson.id
                              ? "page"
                              : undefined
                          }
                          href={`/learner/courses/${enrollmentId}?lesson=${lesson.id}#lesson-player`}
                        >
                          {lesson.completed ? "✓ " : ""}
                          {lesson.title}
                        </Link>
                      ) : (
                        <span>
                          {lesson.completed ? "✓ " : lesson.locked ? "🔒 " : ""}
                          {lesson.title}
                        </span>
                      )}
                      {lesson.locked && lesson.lockReason && (
                        <small>{lesson.lockReason}</small>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
          {workspace.components.length > 0 && (
            <section>
              <h3>混合課順序</h3>
              <ol>
                {workspace.components.map((component) => (
                  <li key={component.id}>
                    <span>
                      {component.completed ? "✓ " : ""}
                      {component.title}（
                      {component.type === "recorded" ? "錄播" : "直播"}）
                    </span>
                    {component.type === "recorded" &&
                      component.requiredSeconds > 0 && (
                        <small>
                          已認列 {Math.floor(component.confirmedSeconds / 60)}／
                          {Math.ceil(component.requiredSeconds / 60)} 分鐘
                        </small>
                      )}
                    {!component.completed &&
                      !component.prerequisitesComplete && (
                        <small>需先完成前置步驟</small>
                      )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>

        <div className="lesson-area" id="lesson-player">
          {selectedLesson?.videoVersionId ? (
            <>
              <p className="eyebrow">{selectedLesson.moduleTitle}</p>
              <h2>{selectedLesson.title}</h2>
              <RecordedClassroom
                customerCode={
                  process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE
                }
                enrollmentId={enrollmentId}
                lessonVideoVersionId={selectedLesson.videoVersionId}
              />
            </>
          ) : (
            <div className="empty-state">
              <h2>目前沒有可播放的錄播單元</h2>
              <p>
                如果這是同步直播或混合課，請依下方已報名場次與先修順序進行。
              </p>
            </div>
          )}
        </div>
      </div>

      {workspace.materials.length > 0 && (
        <section className="single-step-form">
          <h2>課程教材</h2>
          <p>
            教材不使用公開連結；每次下載都會重新確認目前帳號的有效修課權限。
          </p>
          {workspace.materials.map((material) => (
            <CourseMaterialDownloadButton
              key={material.id}
              materialId={material.id}
              title={material.title}
            />
          ))}
        </section>
      )}

      {workspace.liveBookings.length > 0 && (
        <section className="live-booking-list">
          <h2>我已報名的所有直播場次</h2>
          {workspace.liveBookings.map((booking) => (
            <LiveBookingCard booking={booking} key={booking.bookingId} />
          ))}
        </section>
      )}

      <AccreditationIdentitySection
        enrollmentId={enrollmentId}
        identity={workspace.identity}
      />
      <CompletionSteps enrollmentId={enrollmentId} />
      <QuizInvalidationStatus enrollmentId={enrollmentId} />
      {workspace.certificate && (
        <section className="single-step-form">
          <h2>
            {workspace.certificate.kind === "accreditation"
              ? "主管機關積分證明"
              : "歲悅學苑完課證明"}
          </h2>
          <p>
            {
              presentStatus("certificate", workspace.certificate.status)
                .description
            }
          </p>
          <CertificateDownloadButton certificateId={workspace.certificate.id} />
        </section>
      )}
      {workspace.accreditationStatus !== "credited" && (
        <div className="empty-state">
          <h2>積分尚未顯示為已登錄</h2>
          <p>
            完課證明與主管機關積分結果是兩件事。只有送審結果回填為「積分已登錄」後，頁面才會如此標示。
          </p>
        </div>
      )}
    </section>
  );
}
