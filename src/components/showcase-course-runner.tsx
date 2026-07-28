"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CourseRunnerActivityHeading } from "@/components/course-runner-activity-heading";
import {
  CourseRunnerFrame,
  type CourseRunnerActivityNavigation,
  type CourseRunnerModuleNavigation,
  type CourseRunnerTaskNavigation,
} from "@/components/course-runner-frame";
import { ShowcaseQuizPreview } from "@/components/showcase-quiz-preview";
import { ShowcaseSurveyPreview } from "@/components/showcase-survey-preview";
import type { ShowcaseCourse } from "@/content/showcase-courses";

type DemoActivity = CourseRunnerActivityNavigation & {
  moduleTitle: string;
};

function inferDemoKind(lesson: string): CourseRunnerActivityNavigation["kind"] {
  if (/測驗|評量|情境題/.test(lesson)) return "quiz";
  if (/滿意度|問卷/.test(lesson)) return "survey";
  if (/直播/.test(lesson)) return "live";
  if (/教材|講義|投影片/.test(lesson)) return "material";
  return "video";
}

function activityMeta(
  kind: CourseRunnerActivityNavigation["kind"],
  index: number,
) {
  return {
    video: `錄播影片・約 ${10 + ((index * 3) % 8)} 分鐘`,
    material: "教室內教材",
    quiz: "10 題・80 分及格",
    survey: "約 2 分鐘",
    live: "同步教室",
    identity: "積分資料",
  }[kind];
}

export function ShowcaseCourseRunner({
  course,
  initialActivityId,
}: {
  course: ShowcaseCourse;
  initialActivityId?: string;
}) {
  const router = useRouter();
  const modules = useMemo<CourseRunnerModuleNavigation[]>(
    () =>
      course.modules.map((module, moduleIndex) => ({
        id: `module-${moduleIndex + 1}`,
        title: module.title,
        activities: module.lessons.map((lesson, lessonIndex) => {
          const kind = inferDemoKind(lesson);
          return {
            id: `lesson-${moduleIndex + 1}-${lessonIndex + 1}`,
            title: lesson,
            kind,
            meta: activityMeta(kind, moduleIndex * 4 + lessonIndex),
            completed: moduleIndex === 0 && lessonIndex === 0,
            locked: false,
            lockReason: null,
          };
        }),
      })),
    [course.modules],
  );
  const flatActivities = useMemo(
    () =>
      modules.flatMap((module) =>
        module.activities.map(
          (activity): DemoActivity => ({
            ...activity,
            moduleTitle: module.title,
          }),
        ),
      ),
    [modules],
  );
  const safeInitialActivity =
    flatActivities.find((activity) => activity.id === initialActivityId)?.id ??
    flatActivities[1]?.id ??
    flatActivities[0]?.id ??
    "";
  const [activeActivityId, setActiveActivityId] = useState(safeInitialActivity);
  const activeActivity =
    flatActivities.find((activity) => activity.id === activeActivityId) ??
    flatActivities[0];
  const activeIndex = flatActivities.findIndex(
    (activity) => activity.id === activeActivity?.id,
  );
  const previousActivity =
    activeIndex > 0
      ? {
          id: flatActivities[activeIndex - 1]!.id,
          title: flatActivities[activeIndex - 1]!.title,
        }
      : null;
  const nextActivity =
    activeIndex >= 0 && activeIndex < flatActivities.length - 1
      ? {
          id: flatActivities[activeIndex + 1]!.id,
          title: flatActivities[activeIndex + 1]!.title,
        }
      : null;
  const firstVideo =
    flatActivities.find((activity) => activity.kind === "video")?.id ?? "";
  const firstQuiz =
    flatActivities.find((activity) => activity.kind === "quiz")?.id ??
    flatActivities.at(-1)?.id ??
    "";
  const firstSurvey =
    flatActivities.find((activity) => activity.kind === "survey")?.id ??
    firstQuiz;
  const firstLive =
    flatActivities.find((activity) => activity.kind === "live")?.id ??
    firstVideo;
  const tasks: CourseRunnerTaskNavigation[] = [
    {
      id: "watch",
      title: "觀看錄播課程",
      detail: `28／${course.durationMinutes} 分鐘`,
      state: "current",
      activityId: firstVideo,
    },
    ...(course.deliveryType === "hybrid"
      ? [
          {
            id: "live",
            title: "同步直播出席",
            detail: "尚未選擇場次",
            state: "pending" as const,
            activityId: firstLive,
          },
        ]
      : []),
    {
      id: "quiz",
      title: "課後測驗",
      detail: "80 分及格",
      state: "pending",
      activityId: firstQuiz,
    },
    {
      id: "survey",
      title: "滿意度調查",
      detail: "尚未填寫",
      state: "pending",
      activityId: firstSurvey,
    },
    {
      id: "certificate",
      title: "證明與積分",
      detail: "完成條件後產生",
      state: "pending",
      activityId: flatActivities.at(-1)?.id ?? firstQuiz,
    },
  ];

  function selectActivity(activityId: string) {
    setActiveActivityId(activityId);
    router.replace(
      `/courses/demo/${encodeURIComponent(course.slug)}/classroom?activity=${encodeURIComponent(activityId)}`,
      { scroll: false },
    );
  }

  let content = null;
  if (activeActivity?.kind === "video") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="正式課程會使用受保護影片、每 15 秒同步狀態，並於每 10 分鐘進行在席確認。"
          eyebrow={activeActivity.moduleTitle}
          title={activeActivity.title}
        />
        <div className="showcase-classroom-video">
          <div className="viewer-overlay">視覺示範・不計分鐘</div>
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={`https://www.youtube-nocookie.com/embed/${course.youtubeId}?rel=0`}
            title={`${course.youtubeTitle}公開示範影片`}
          />
        </div>
        <section className="video-learning-status demo-learning-status">
          <div className="learning-state state-paused">
            <span aria-hidden="true" />
            <div>
              <strong>示範模式不計時</strong>
              <small>正式課程才會顯示最後同步時間</small>
            </div>
          </div>
          <div>
            <span>正式有效觀看</span>
            <strong>28／{course.durationMinutes} 分鐘</strong>
          </div>
          <div>
            <span>下次在席確認</span>
            <strong>約 7 分鐘後</strong>
          </div>
        </section>
        <section className="course-runner-resource-panel">
          <div>
            <span>本單元資源</span>
            <strong>2 份教材</strong>
          </div>
          <button className="button secondary" disabled type="button">
            單元講義 PDF
          </button>
          <button className="button secondary" disabled type="button">
            照護情境檢核表
          </button>
          <p>正式教材會在下載前重新驗證修課權限。</p>
        </section>
      </>
    );
  } else if (activeActivity?.kind === "quiz") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="正式測驗會逐題保存、支援重新整理恢復，並由伺服器評分。"
          eyebrow={activeActivity.moduleTitle}
          title={activeActivity.title}
        />
        <ShowcaseQuizPreview />
      </>
    );
  } else if (activeActivity?.kind === "survey") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="完成五項評分後，正式課程會立即更新完課條件。"
          eyebrow={activeActivity.moduleTitle}
          title={activeActivity.title}
        />
        <ShowcaseSurveyPreview />
      </>
    );
  } else if (activeActivity?.kind === "live") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="正式課程會顯示設備檢查、簽到、加入教室與簽退狀態。"
          eyebrow={activeActivity.moduleTitle}
          title={activeActivity.title}
        />
        <section className="showcase-live-session-card">
          <div>
            <span>下一場示範</span>
            <strong>8 月 18 日（二）14:00–15:30</strong>
          </div>
          <ol>
            <li className="complete">設備檢查</li>
            <li>課前簽到</li>
            <li>網站內加入 Zoom 教室</li>
            <li>完成簽退</li>
          </ol>
          <button className="button" disabled type="button">
            尚未到開放時間
          </button>
        </section>
      </>
    );
  } else {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="正式教材將以受保護下載或教室內閱讀方式提供。"
          eyebrow={activeActivity?.moduleTitle ?? "課程教材"}
          title={activeActivity?.title ?? "課程教材"}
        />
        <section className="course-runner-material-viewer">
          <div aria-hidden="true">PDF</div>
          <h2>照護實務講義</h2>
          <p>教室內可直接查看教材摘要，並依權限下載完整 PDF。</p>
          <button className="button secondary" disabled type="button">
            示範模式不提供下載
          </button>
        </section>
      </>
    );
  }

  return (
    <CourseRunnerFrame
      activeActivityId={activeActivityId}
      backHref={`/courses/demo/${course.slug}`}
      confirmedMinutes={28}
      courseTitle={course.title}
      demoNotice="公開影片只用來展示教室操作，不保存進度、不進行防掛機，也不產生長照積分。"
      modules={modules}
      nextActivity={nextActivity}
      onSelectActivity={selectActivity}
      previousActivity={previousActivity}
      progressPercent={24}
      requiredMinutes={course.durationMinutes}
      syncLabel="示範資料不保存"
      tasks={tasks}
    >
      {content}
    </CourseRunnerFrame>
  );
}
