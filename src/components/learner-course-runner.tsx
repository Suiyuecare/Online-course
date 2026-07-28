"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { LearnerWorkspace } from "@/application/workspace";
import { AccreditationIdentitySection } from "@/components/accreditation-identity-section";
import { CertificateDownloadButton } from "@/components/certificate-download-button";
import { CourseRunnerActivityHeading } from "@/components/course-runner-activity-heading";
import {
  CourseRunnerFrame,
  type CourseRunnerActivityNavigation,
  type CourseRunnerModuleNavigation,
  type CourseRunnerTaskNavigation,
} from "@/components/course-runner-frame";
import { CourseMaterialDownloadButton } from "@/components/course-material-download-button";
import { LiveBookingCard } from "@/components/live-booking-card";
import { QuizInvalidationStatus } from "@/components/quiz-invalidation-status";
import { QuizActivity } from "@/components/quiz-activity";
import { RecordedClassroom } from "@/components/recorded-classroom";
import { SurveyActivity } from "@/components/survey-activity";
import { presentStatus } from "@/domain/presentation";

const specialActivity = {
  identity: "identity",
  live: "live-sessions",
  quiz: "course-quiz",
  survey: "course-survey",
  certificate: "certificate-and-credit",
} as const;

type LessonActivity = LearnerWorkspace["modules"][number]["lessons"][number] & {
  moduleId: string;
  moduleTitle: string;
};

function lessonKind(
  type: LessonActivity["type"],
): CourseRunnerActivityNavigation["kind"] {
  return type;
}

function lessonMeta(lesson: LessonActivity): string {
  if (lesson.locked) return lesson.lockReason ?? "尚未開放";
  if (lesson.completed) return "已完成，可重新查看";
  if (lesson.type === "video" && lesson.resumeSeconds > 0) {
    return `上次看到 ${Math.floor(lesson.resumeSeconds / 60)} 分`;
  }
  return {
    video: "錄播課程",
    material: "課程教材",
    quiz: "80 分及格",
    survey: "完課回饋",
  }[lesson.type];
}

function statusState(
  completed: boolean,
  current: boolean,
  attention = false,
): CourseRunnerTaskNavigation["state"] {
  if (completed) return "complete";
  if (attention) return "attention";
  return current ? "current" : "pending";
}

function minutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

function requiredMinutes(seconds: number): number {
  return Math.ceil(Math.max(0, seconds) / 60);
}

function resolveActivityId(
  requestedActivityId: string | undefined,
  lessons: LessonActivity[],
  allowedSpecialActivities: Set<string>,
): string {
  if (requestedActivityId) {
    const requestedLesson = lessons.find(
      (lesson) => lesson.id === requestedActivityId,
    );
    if (requestedLesson && !requestedLesson.locked) {
      return requestedLesson.id;
    }
    if (allowedSpecialActivities.has(requestedActivityId)) {
      return requestedActivityId;
    }
  }
  return (
    lessons.find((lesson) => !lesson.completed && !lesson.locked)?.id ??
    lessons.find((lesson) => !lesson.locked)?.id ??
    [...allowedSpecialActivities][0] ??
    specialActivity.identity
  );
}

export function LearnerCourseRunner({
  enrollmentId,
  initialActivityId,
  projectionReady,
  workspace,
}: {
  enrollmentId: string;
  initialActivityId?: string;
  projectionReady: boolean;
  workspace: LearnerWorkspace;
}) {
  const router = useRouter();
  const lessons = useMemo(
    () =>
      workspace.modules.flatMap((module) =>
        module.lessons.map((lesson) => ({
          ...lesson,
          moduleId: module.id,
          moduleTitle: module.title,
        })),
      ),
    [workspace.modules],
  );
  const quizLesson = lessons.find((lesson) => lesson.type === "quiz");
  const surveyLesson = lessons.find((lesson) => lesson.type === "survey");
  const hasVideo = lessons.some((lesson) => lesson.type === "video");
  const hasLive =
    workspace.deliveryType !== "recorded" || workspace.liveBookings.length > 0;
  const allowedSpecialActivities = useMemo(
    () =>
      new Set([
        specialActivity.identity,
        specialActivity.quiz,
        specialActivity.survey,
        specialActivity.certificate,
        ...(hasLive ? [specialActivity.live] : []),
      ]),
    [hasLive],
  );
  const resolvedInitialActivityId = resolveActivityId(
    initialActivityId,
    lessons,
    allowedSpecialActivities,
  );
  const [activeActivityId, setActiveActivityId] = useState(
    resolvedInitialActivityId,
  );

  const activeLesson =
    lessons.find((lesson) => lesson.id === activeActivityId) ?? null;
  const moduleNavigation: CourseRunnerModuleNavigation[] =
    workspace.modules.map((module) => ({
      id: module.id,
      title: module.title,
      activities: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        kind: lessonKind(lesson.type),
        meta: lessonMeta({
          ...lesson,
          moduleId: module.id,
          moduleTitle: module.title,
        }),
        completed: lesson.completed,
        locked: lesson.locked,
        lockReason: lesson.lockReason,
      })),
    }));

  const requiredWatchMinutes = requiredMinutes(
    workspace.completion.requiredWatchSeconds,
  );
  const confirmedWatchMinutes = minutes(
    workspace.completion.confirmedValidSeconds,
  );
  const watchComplete =
    !hasVideo ||
    workspace.completion.requiredWatchSeconds === 0 ||
    workspace.completion.confirmedValidSeconds >=
      workspace.completion.requiredWatchSeconds;
  const identityNeedsAttention =
    workspace.identity !== null &&
    ["needs_correction", "rejected"].includes(workspace.identity.status);

  const taskSeeds = [
    ...(hasVideo
      ? [
          {
            id: "watch",
            title: "觀看錄播課程",
            detail:
              requiredWatchMinutes > 0
                ? `${confirmedWatchMinutes}／${requiredWatchMinutes} 分鐘`
                : `${confirmedWatchMinutes} 分鐘已確認`,
            completed: watchComplete,
            activityId:
              lessons.find(
                (lesson) =>
                  lesson.type === "video" &&
                  !lesson.completed &&
                  !lesson.locked,
              )?.id ??
              lessons.find(
                (lesson) => lesson.type === "video" && !lesson.locked,
              )?.id ??
              specialActivity.identity,
            attention: false,
          },
        ]
      : []),
    {
      id: "identity",
      title: "積分身分確認",
      detail: workspace.completion.identityVerified
        ? "資料已驗證"
        : identityNeedsAttention
          ? "資料需要補正"
          : "尚待完成或審核",
      completed: workspace.completion.identityVerified,
      activityId: specialActivity.identity,
      attention: identityNeedsAttention,
    },
    ...(hasLive
      ? [
          {
            id: "live",
            title: "同步直播出席",
            detail: workspace.completion.allLiveQualified
              ? "出席已合格"
              : workspace.liveBookings.length > 0
                ? `${workspace.liveBookings.length} 個已報名場次`
                : "尚未選擇場次",
            completed: workspace.completion.allLiveQualified,
            activityId: specialActivity.live,
            attention: false,
          },
        ]
      : []),
    {
      id: "quiz",
      title: "課後測驗",
      detail: workspace.completion.quizPassed ? "已達 80 分" : "80 分及格",
      completed: workspace.completion.quizPassed,
      activityId: quizLesson?.id ?? specialActivity.quiz,
      attention: false,
    },
    {
      id: "survey",
      title: "滿意度調查",
      detail: workspace.completion.surveyCompleted ? "已完成" : "尚未填寫",
      completed: workspace.completion.surveyCompleted,
      activityId: surveyLesson?.id ?? specialActivity.survey,
      attention: false,
    },
    {
      id: "certificate",
      title: "證明與積分",
      detail: workspace.certificate
        ? presentStatus("certificate", workspace.certificate.status).label
        : "完成全部條件後產生",
      completed: Boolean(workspace.certificate),
      activityId: specialActivity.certificate,
      attention: false,
    },
  ];
  const firstIncompleteTaskId = taskSeeds.find(
    (task) => !task.completed && !task.attention,
  )?.id;
  const tasks: CourseRunnerTaskNavigation[] = taskSeeds.map((task) => ({
    id: task.id,
    title: task.title,
    detail: task.detail,
    activityId: task.activityId,
    state: statusState(
      task.completed,
      task.id === firstIncompleteTaskId,
      task.attention,
    ),
  }));

  const completionChecks = taskSeeds.filter(
    (task) => task.id !== "certificate",
  );
  const progressPercent =
    completionChecks.length === 0
      ? 0
      : Math.round(
          (completionChecks.filter((task) => task.completed).length /
            completionChecks.length) *
            100,
        );
  const navigableLessons = lessons.filter((lesson) => !lesson.locked);
  const activeLessonIndex = navigableLessons.findIndex(
    (lesson) => lesson.id === activeActivityId,
  );
  const previousActivity =
    activeLessonIndex > 0
      ? {
          id: navigableLessons[activeLessonIndex - 1]!.id,
          title: navigableLessons[activeLessonIndex - 1]!.title,
        }
      : null;
  const nextActivity =
    activeLessonIndex >= 0 && activeLessonIndex < navigableLessons.length - 1
      ? {
          id: navigableLessons[activeLessonIndex + 1]!.id,
          title: navigableLessons[activeLessonIndex + 1]!.title,
        }
      : null;

  function selectActivity(activityId: string) {
    setActiveActivityId(activityId);
    const params = new URLSearchParams();
    params.set("activity", activityId);
    router.replace(
      `/learner/courses/${encodeURIComponent(enrollmentId)}?${params.toString()}`,
      { scroll: false },
    );
  }

  const materialsForLesson = activeLesson
    ? workspace.materials.filter(
        (material) =>
          material.lessonId === activeLesson.id || material.lessonId === null,
      )
    : workspace.materials;

  let content;
  if (activeLesson?.type === "video") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="影片固定 1 倍速；只有畫面在前景、影片播放且網路正常時才會累積候選分鐘。"
          eyebrow={activeLesson.moduleTitle}
          title={activeLesson.title}
        />
        {activeLesson.videoVersionId ? (
          <RecordedClassroom
            customerCode={
              process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE
            }
            enrollmentId={enrollmentId}
            initialConfirmedSeconds={workspace.completion.confirmedValidSeconds}
            lessonVideoVersionId={activeLesson.videoVersionId}
            requiredSeconds={workspace.completion.requiredWatchSeconds}
          />
        ) : (
          <div className="course-runner-empty">
            <strong>影片正在準備中</strong>
            <p>影片未完成安全處理前不會提供播放，也不會誤算分鐘。</p>
          </div>
        )}
        <section className="course-runner-resource-panel">
          <div>
            <span>本單元教材</span>
            <strong>
              {materialsForLesson.length > 0
                ? `${materialsForLesson.length} 份`
                : "尚無附件"}
            </strong>
          </div>
          {materialsForLesson.map((material) => (
            <CourseMaterialDownloadButton
              key={material.id}
              materialId={material.id}
              title={material.title}
            />
          ))}
          <p>教材下載會再次驗證目前修課權限，不會產生可轉傳的永久公開連結。</p>
        </section>
      </>
    );
  } else if (activeLesson?.type === "material") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="所有教材都會在下載前重新確認修課權限。"
          eyebrow={activeLesson.moduleTitle}
          title={activeLesson.title}
        />
        <section className="course-runner-material-viewer">
          <div aria-hidden="true">PDF</div>
          <h2>課程教材</h2>
          {materialsForLesson.length === 0 ? (
            <p>這個單元目前沒有可下載的教材。</p>
          ) : (
            materialsForLesson.map((material) => (
              <CourseMaterialDownloadButton
                key={material.id}
                materialId={material.id}
                title={material.title}
              />
            ))
          )}
          <p className="muted-copy">
            下一版可在此區直接閱讀投影片與 PDF；目前先提供受保護下載。
          </p>
        </section>
      </>
    );
  } else if (activeLesson?.type === "quiz") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="每次隨機 10 題、30 分鐘、80 分及格；答案會保存在這台裝置，重新整理後可繼續。"
          eyebrow={activeLesson.moduleTitle}
          title={activeLesson.title}
        />
        <QuizActivity
          enrollmentId={enrollmentId}
          initiallyPassed={workspace.completion.quizPassed}
        />
        <QuizInvalidationStatus enrollmentId={enrollmentId} />
      </>
    );
  } else if (activeLesson?.type === "survey") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="完成滿意度後，系統會重新檢查其餘完課條件。"
          eyebrow={activeLesson.moduleTitle}
          title={activeLesson.title}
        />
        <SurveyActivity
          enrollmentId={enrollmentId}
          initiallyCompleted={workspace.completion.surveyCompleted}
        />
      </>
    );
  } else if (activeActivityId === specialActivity.identity) {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="積分課程必須確認本人資料；客服只能看到遮罩狀態。"
          eyebrow="完課任務"
          title="積分身分確認"
        />
        <AccreditationIdentitySection
          enrollmentId={enrollmentId}
          identity={workspace.identity}
        />
      </>
    );
  } else if (activeActivityId === specialActivity.live) {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="請在課前完成設備檢查、簽到，並從網站內加入同步教室。"
          eyebrow="同步直播"
          title="我已報名的直播場次"
        />
        {workspace.liveBookings.length > 0 ? (
          <div className="live-booking-list">
            {workspace.liveBookings.map((booking) => (
              <LiveBookingCard booking={booking} key={booking.bookingId} />
            ))}
          </div>
        ) : (
          <div className="course-runner-empty">
            <strong>目前沒有已報名的直播場次</strong>
            <p>完成付款或由機構指派後，可選場的時段會顯示在這裡。</p>
          </div>
        )}
      </>
    );
  } else if (activeActivityId === specialActivity.quiz) {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="每次隨機 10 題、30 分鐘、80 分及格；可以不限次數補考。"
          eyebrow="完課任務"
          title="課後測驗"
        />
        <QuizActivity
          enrollmentId={enrollmentId}
          initiallyPassed={workspace.completion.quizPassed}
        />
        <QuizInvalidationStatus enrollmentId={enrollmentId} />
      </>
    );
  } else if (activeActivityId === specialActivity.survey) {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="你的回饋會用來改善課程，完成後系統會更新完課狀態。"
          eyebrow="完課任務"
          title="滿意度調查"
        />
        <SurveyActivity
          enrollmentId={enrollmentId}
          initiallyCompleted={workspace.completion.surveyCompleted}
        />
      </>
    );
  } else {
    const certificateStatus = workspace.certificate
      ? presentStatus("certificate", workspace.certificate.status)
      : null;
    content = (
      <>
        <CourseRunnerActivityHeading
          description="平台完課證明與主管機關積分登錄是兩個不同階段。"
          eyebrow="學習成果"
          title="證明與長照積分"
        />
        <section className="course-runner-certificate">
          <div className="certificate-preview" aria-hidden="true">
            <span>歲悅學苑</span>
            <strong>完課證明</strong>
            <i>✓</i>
          </div>
          <div>
            {workspace.certificate ? (
              <>
                <span className={`status status-${certificateStatus?.tone}`}>
                  {certificateStatus?.label}
                </span>
                <h2>
                  {workspace.certificate.kind === "accreditation"
                    ? "主管機關積分證明"
                    : "歲悅學苑完課證明"}
                </h2>
                <p>{certificateStatus?.description}</p>
                <CertificateDownloadButton
                  certificateId={workspace.certificate.id}
                />
              </>
            ) : (
              <>
                <span className="status status-neutral">尚未產生</span>
                <h2>完成所有條件後才能取得證明</h2>
                <p>
                  請回到左側完課進度，依序完成尚未打勾的觀看、身分、測驗、問卷或直播任務。
                </p>
              </>
            )}
            <div className="credit-status-row">
              <span>主管機關積分</span>
              <strong>
                {workspace.accreditationStatus === "credited"
                  ? "積分已登錄"
                  : "尚未顯示為已登錄"}
              </strong>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <CourseRunnerFrame
      activeActivityId={activeActivityId}
      backHref="/learner"
      confirmedMinutes={confirmedWatchMinutes}
      courseTitle={workspace.courseTitle}
      modules={moduleNavigation}
      nextActivity={nextActivity}
      onSelectActivity={selectActivity}
      previousActivity={previousActivity}
      progressPercent={progressPercent}
      requiredMinutes={requiredWatchMinutes}
      syncLabel={projectionReady ? "進度由伺服器保存" : "部分進度正在重新同步"}
      tasks={tasks}
    >
      {!projectionReady && (
        <div className="course-runner-inline-warning" role="alert">
          部分完成狀態暫時無法同步；影片仍會依你的個人權限安全驗證。
        </div>
      )}
      {content}
    </CourseRunnerFrame>
  );
}
