"use client";

import Image from "next/image";
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
import { useAccessibleModal } from "@/components/use-accessible-modal";
import type { ShowcaseCourse } from "@/content/showcase-courses";

type DemoActivity = CourseRunnerActivityNavigation & {
  moduleTitle: string;
};

function inferDemoKind(
  lesson: string,
  moduleTitle: string,
  deliveryType: ShowcaseCourse["deliveryType"],
): CourseRunnerActivityNavigation["kind"] {
  if (/測驗|評量|情境題/.test(lesson)) return "quiz";
  if (/滿意度|問卷/.test(lesson)) return "survey";
  if (/直播/.test(lesson) || /同步直播/.test(moduleTitle)) return "live";
  if (/教材|講義|投影片/.test(lesson)) return "material";
  if (deliveryType === "live") return "material";
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
  const certificateActivityId = "demo-certificate";
  const modules = useMemo<CourseRunnerModuleNavigation[]>(
    () =>
      course.modules.map((module, moduleIndex) => ({
        id: `module-${moduleIndex + 1}`,
        title: module.title,
        activities: module.lessons.map((lesson, lessonIndex) => {
          const kind = inferDemoKind(lesson, module.title, course.deliveryType);
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
    [course.deliveryType, course.modules],
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
  const initialConfirmedMinutes = course.deliveryType === "live" ? 0 : 28;
  const [confirmedMinutes, setConfirmedMinutes] = useState(
    Math.min(initialConfirmedMinutes, course.durationMinutes),
  );
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [presenceConfirmed, setPresenceConfirmed] = useState(false);
  const [offlineVideo, setOfflineVideo] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [surveyCompleted, setSurveyCompleted] = useState(false);
  const [liveAttendanceComplete, setLiveAttendanceComplete] = useState(false);
  const presenceDialogRef = useAccessibleModal(presenceOpen, () =>
    setPresenceOpen(false),
  );
  const safeInitialActivity =
    initialActivityId === certificateActivityId
      ? certificateActivityId
      : (flatActivities.find((activity) => activity.id === initialActivityId)
          ?.id ??
        flatActivities[1]?.id ??
        flatActivities[0]?.id ??
        "");
  const [activeActivityId, setActiveActivityId] = useState(safeInitialActivity);
  const certificateSelected = activeActivityId === certificateActivityId;
  const activeActivity = certificateSelected
    ? undefined
    : (flatActivities.find((activity) => activity.id === activeActivityId) ??
      flatActivities[0]);
  const activeIndex = flatActivities.findIndex(
    (activity) => activity.id === activeActivity?.id,
  );
  const previousActivity = certificateSelected
    ? flatActivities.at(-1)
      ? {
          id: flatActivities.at(-1)!.id,
          title: flatActivities.at(-1)!.title,
        }
      : null
    : activeIndex > 0
      ? {
          id: flatActivities[activeIndex - 1]!.id,
          title: flatActivities[activeIndex - 1]!.title,
        }
      : null;
  const nextActivity = certificateSelected
    ? null
    : activeIndex >= 0 && activeIndex < flatActivities.length - 1
      ? {
          id: flatActivities[activeIndex + 1]!.id,
          title: flatActivities[activeIndex + 1]!.title,
        }
      : activeIndex === flatActivities.length - 1
        ? {
            id: certificateActivityId,
            title: "證明與積分",
          }
        : null;
  const firstVideo =
    flatActivities.find((activity) => activity.kind === "video")?.id ?? "";
  const hasVideo = Boolean(firstVideo);
  const firstQuiz =
    flatActivities.find((activity) => activity.kind === "quiz")?.id ?? "";
  const hasQuiz = Boolean(firstQuiz);
  const firstSurvey =
    flatActivities.find((activity) => activity.kind === "survey")?.id ?? "";
  const hasSurvey = Boolean(firstSurvey);
  const firstLive =
    flatActivities.find((activity) => activity.kind === "live")?.id ?? "";
  const hasLive = Boolean(firstLive);
  const watchComplete = !hasVideo || confirmedMinutes >= course.durationMinutes;
  const quizComplete = !hasQuiz || (quizScore !== null && quizScore >= 80);
  const surveyComplete = !hasSurvey || surveyCompleted;
  const liveComplete = !hasLive || liveAttendanceComplete;
  const completionEligible =
    watchComplete && quizComplete && surveyComplete && liveComplete;
  const tasks: CourseRunnerTaskNavigation[] = [
    ...(hasVideo
      ? [
          {
            id: "watch",
            title: "觀看錄播課程",
            detail: `${confirmedMinutes}／${course.durationMinutes} 分鐘`,
            state: watchComplete ? ("complete" as const) : ("current" as const),
            activityId: firstVideo,
          },
        ]
      : []),
    ...(hasLive
      ? [
          {
            id: "live",
            title: "同步直播出席",
            detail: liveAttendanceComplete
              ? "合成簽到退已完成"
              : course.deliveryType === "live"
                ? "尚未簽到"
                : "尚未選擇場次",
            state: liveAttendanceComplete
              ? ("complete" as const)
              : hasVideo
                ? ("pending" as const)
                : ("current" as const),
            activityId: firstLive,
          },
        ]
      : []),
    ...(hasQuiz
      ? [
          {
            id: "quiz",
            title: "課後測驗",
            detail:
              quizScore === null ? "80 分及格" : `示範成績 ${quizScore} 分`,
            state:
              quizScore !== null && quizScore >= 80
                ? ("complete" as const)
                : ("pending" as const),
            activityId: firstQuiz,
          },
        ]
      : []),
    ...(hasSurvey
      ? [
          {
            id: "survey",
            title: "滿意度調查",
            detail: surveyCompleted ? "示範填寫完成" : "尚未填寫",
            state: surveyCompleted
              ? ("complete" as const)
              : ("pending" as const),
            activityId: firstSurvey,
          },
        ]
      : []),
    {
      id: "certificate",
      title: "證明與積分",
      detail: completionEligible ? "合成證明可預覽" : "完成條件後產生",
      state: completionEligible ? "complete" : "pending",
      activityId: certificateActivityId,
    },
  ];
  const progressPercent = hasVideo
    ? Math.min(
        100,
        Math.round((confirmedMinutes / course.durationMinutes) * 100),
      )
    : liveAttendanceComplete
      ? 100
      : 0;

  function loadSyntheticCompletion() {
    if (hasVideo) {
      setConfirmedMinutes(course.durationMinutes);
      setPresenceConfirmed(true);
    }
    if (hasQuiz) {
      setQuizScore(100);
    }
    if (hasSurvey) {
      setSurveyCompleted(true);
    }
    if (hasLive) {
      setLiveAttendanceComplete(true);
    }
  }

  function selectActivity(activityId: string) {
    setActiveActivityId(activityId);
    router.replace(
      `/courses/demo/${encodeURIComponent(course.slug)}/classroom?activity=${encodeURIComponent(activityId)}`,
      { scroll: false },
    );
  }

  let content = null;
  if (certificateSelected) {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="這裡示範完課條件如何即時彙整；所有姓名、成績與證明編號都是合成資料。"
          eyebrow="學習成果"
          title="證明與長照積分"
        />
        <section className="course-runner-certificate showcase-demo-certificate">
          <div className="certificate-preview" aria-hidden="true">
            <span>歲悅學苑・展示版本</span>
            <strong>{completionEligible ? "完課證明" : "條件檢核中"}</strong>
            <i>{completionEligible ? "✓" : "…"}</i>
            <small>{completionEligible ? "林美華" : "尚未產生證明"}</small>
          </div>
          <div>
            <span
              className={`status ${
                completionEligible ? "status-success" : "status-neutral"
              }`}
            >
              {completionEligible ? "合成成果已完成" : "尚有條件待完成"}
            </span>
            <h2>
              {completionEligible
                ? "可以預覽完整的完課結果"
                : "完成下列條件後才會產生證明"}
            </h2>
            <p>
              {completionEligible
                ? "正式環境會由伺服器重新檢查有效觀看、測驗、問卷與直播出席，再核發具有校驗碼的證明。"
                : "你可以逐項操作，也可以載入一組完整合成成果，快速向客戶展示完課後畫面。"}
            </p>
            <ul className="showcase-completion-checklist">
              {hasVideo && (
                <li className={watchComplete ? "complete" : undefined}>
                  <span aria-hidden="true">{watchComplete ? "✓" : "•"}</span>
                  <strong>有效觀看</strong>
                  <small>
                    {confirmedMinutes}／{course.durationMinutes} 分鐘
                  </small>
                </li>
              )}
              {hasLive && (
                <li className={liveComplete ? "complete" : undefined}>
                  <span aria-hidden="true">{liveComplete ? "✓" : "•"}</span>
                  <strong>直播出席</strong>
                  <small>{liveComplete ? "簽到退已完成" : "尚未完成"}</small>
                </li>
              )}
              {hasQuiz && (
                <li className={quizComplete ? "complete" : undefined}>
                  <span aria-hidden="true">{quizComplete ? "✓" : "•"}</span>
                  <strong>課後測驗</strong>
                  <small>
                    {quizScore === null ? "80 分及格" : `${quizScore} 分`}
                  </small>
                </li>
              )}
              {hasSurvey && (
                <li className={surveyComplete ? "complete" : undefined}>
                  <span aria-hidden="true">{surveyComplete ? "✓" : "•"}</span>
                  <strong>滿意度調查</strong>
                  <small>{surveyComplete ? "已完成" : "尚未填寫"}</small>
                </li>
              )}
            </ul>
            {!completionEligible && (
              <button
                className="button"
                onClick={loadSyntheticCompletion}
                type="button"
              >
                載入完整合成成果
              </button>
            )}
            {completionEligible && (
              <dl className="showcase-certificate-facts">
                <div>
                  <dt>示範證明編號</dt>
                  <dd>SY-DEMO-2026-000128</dd>
                </div>
                <div>
                  <dt>課後測驗</dt>
                  <dd>{hasQuiz ? `${quizScore ?? 100} 分` : "本課不需測驗"}</dd>
                </div>
                <div>
                  <dt>主管機關積分</dt>
                  <dd>展示資料，不送審</dd>
                </div>
              </dl>
            )}
            <p className="showcase-synthetic-note">
              此操作只切換目前瀏覽器畫面，不寫入資料庫，也不具正式積分或證明效力。
            </p>
          </div>
        </section>
      </>
    );
  } else if (activeActivity?.kind === "video") {
    content = (
      <>
        <CourseRunnerActivityHeading
          description="正式課程會使用受保護影片、每 15 秒同步狀態，並於每 10 分鐘進行在席確認。"
          eyebrow={activeActivity.moduleTitle}
          title={activeActivity.title}
        />
        <div className="showcase-classroom-video">
          <div className="viewer-overlay">視覺示範・不計分鐘</div>
          {offlineVideo ? (
            <div className="showcase-offline-video">
              <Image
                alt=""
                fill
                sizes="(max-width: 760px) 100vw, 900px"
                src={course.coverImage}
              />
              <div>
                <span>離線展示備援</span>
                <strong>{activeActivity.title}</strong>
                <p>
                  即使現場網路封鎖外部影音，仍可繼續示範大綱、在席確認、測驗與滿意度流程。
                </p>
              </div>
            </div>
          ) : (
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={`https://www.youtube-nocookie.com/embed/${course.youtubeId}?rel=0`}
              title={`${course.youtubeTitle}公開示範影片`}
            />
          )}
        </div>
        <div className="showcase-video-switch">
          <span>
            {offlineVideo
              ? "目前使用本站圖片，不依賴外部影音。"
              : "若現場網路無法播放 YouTube，可立即切換備援。"}
          </span>
          <button
            className="button secondary"
            onClick={() => setOfflineVideo((current) => !current)}
            type="button"
          >
            {offlineVideo ? "恢復公開影片" : "切換離線展示"}
          </button>
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
            <span>示範有效觀看</span>
            <strong>
              {confirmedMinutes}／{course.durationMinutes} 分鐘
            </strong>
          </div>
          <div>
            <span>下次在席確認</span>
            <strong>{presenceConfirmed ? "剛剛已確認" : "約 7 分鐘後"}</strong>
          </div>
        </section>
        <section className="showcase-presence-demo">
          <div>
            <span>核心功能互動示範</span>
            <strong>看看 10 分鐘防掛機如何運作</strong>
            <p>
              正式課程跳出確認時會暫停影片；沒有在期限內回應的區段不會計入有效分鐘。
            </p>
          </div>
          <button
            className="button"
            disabled={presenceConfirmed}
            onClick={() => setPresenceOpen(true)}
            type="button"
          >
            {presenceConfirmed ? "本次在席示範已完成" : "立即示範在席確認"}
          </button>
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
        <ShowcaseQuizPreview
          onComplete={setQuizScore}
          onReset={() => setQuizScore(null)}
          score={quizScore}
        />
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
        <ShowcaseSurveyPreview
          completed={surveyCompleted}
          onComplete={() => setSurveyCompleted(true)}
          onReset={() => setSurveyCompleted(false)}
        />
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
            <li className={liveAttendanceComplete ? "complete" : undefined}>
              課前簽到
            </li>
            <li className={liveAttendanceComplete ? "complete" : undefined}>
              網站內加入 Zoom 教室
            </li>
            <li className={liveAttendanceComplete ? "complete" : undefined}>
              完成簽退
            </li>
          </ol>
          <button className="button" disabled type="button">
            尚未到開放時間
          </button>
          <button
            className="button secondary"
            disabled={liveAttendanceComplete}
            onClick={() => setLiveAttendanceComplete(true)}
            type="button"
          >
            {liveAttendanceComplete ? "合成簽到退已完成" : "模擬完成簽到與簽退"}
          </button>
          <p className="showcase-synthetic-note">
            此按鈕只切換展示狀態，不會加入 Zoom 會議或寫入正式出席紀錄。
          </p>
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
      confirmedMinutes={confirmedMinutes}
      courseTitle={course.title}
      demoNotice="公開影片只用來展示教室操作，不保存進度、不進行防掛機，也不產生長照積分。"
      modules={modules}
      nextActivity={nextActivity}
      onSelectActivity={selectActivity}
      previousActivity={previousActivity}
      progressLabel={course.deliveryType === "live" ? "直播出席" : undefined}
      progressPercent={progressPercent}
      progressSummary={
        course.deliveryType === "live"
          ? liveAttendanceComplete
            ? "合成簽到退已完成"
            : "尚未完成簽到"
          : undefined
      }
      requiredMinutes={course.durationMinutes}
      syncLabel="示範資料不保存"
      tasks={tasks}
    >
      {content}
      {presenceOpen && (
        <div
          aria-labelledby="showcase-presence-title"
          aria-modal="true"
          className="presence-dialog"
          ref={presenceDialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <div>
            <span className="step-chip">10 分鐘在席確認</span>
            <h2 id="showcase-presence-title">還在看課程嗎？</h2>
            <p>
              正式課程會在這個畫面暫停影片。請在倒數結束前按下確認，才能繼續認列接下來的觀看分鐘。
            </p>
            <div className="button-row showcase-presence-actions">
              <button
                className="button"
                data-modal-initial-focus
                onClick={() => {
                  setConfirmedMinutes((current) =>
                    Math.min(course.durationMinutes, current + 10),
                  );
                  setPresenceConfirmed(true);
                  setPresenceOpen(false);
                }}
                type="button"
              >
                我還在，繼續上課
              </button>
              <button
                className="button secondary"
                onClick={() => setPresenceOpen(false)}
                type="button"
              >
                先不確認
              </button>
            </div>
            <small>公開示範不會寫入正式學習紀錄。</small>
          </div>
        </div>
      )}
    </CourseRunnerFrame>
  );
}
