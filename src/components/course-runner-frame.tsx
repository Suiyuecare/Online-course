"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

export type CourseRunnerActivityNavigation = {
  id: string;
  title: string;
  kind: "video" | "material" | "quiz" | "survey" | "live" | "identity";
  meta: string;
  completed: boolean;
  locked: boolean;
  lockReason: string | null;
};

export type CourseRunnerModuleNavigation = {
  id: string;
  title: string;
  activities: CourseRunnerActivityNavigation[];
};

export type CourseRunnerTaskNavigation = {
  id: string;
  title: string;
  detail: string;
  state: "complete" | "current" | "pending" | "attention";
  activityId: string;
};

type NeighborActivity = {
  id: string;
  title: string;
} | null;

const activityKindLabels: Record<
  CourseRunnerActivityNavigation["kind"],
  string
> = {
  video: "影片",
  material: "教材",
  quiz: "測驗",
  survey: "問卷",
  live: "直播",
  identity: "身分",
};

function taskStateLabel(state: CourseRunnerTaskNavigation["state"]) {
  return {
    complete: "已完成",
    current: "進行中",
    pending: "待完成",
    attention: "需處理",
  }[state];
}

export function CourseRunnerFrame({
  activeActivityId,
  backHref,
  children,
  confirmedMinutes,
  courseTitle,
  demoNotice,
  modules,
  nextActivity,
  onSelectActivity,
  previousActivity,
  progressLabel,
  progressPercent,
  progressSummary,
  requiredMinutes,
  syncLabel,
  tasks,
}: {
  activeActivityId: string;
  backHref: string;
  children: ReactNode;
  confirmedMinutes: number;
  courseTitle: string;
  demoNotice?: string;
  modules: CourseRunnerModuleNavigation[];
  nextActivity: NeighborActivity;
  onSelectActivity: (activityId: string) => void;
  previousActivity: NeighborActivity;
  progressLabel?: string;
  progressPercent: number;
  progressSummary?: string;
  requiredMinutes: number;
  syncLabel: string;
  tasks: CourseRunnerTaskNavigation[];
}) {
  const [openPanel, setOpenPanel] = useState<"tasks" | "outline" | null>(null);

  useEffect(() => {
    if (!openPanel) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPanel]);

  function selectActivity(activityId: string) {
    setOpenPanel(null);
    onSelectActivity(activityId);
  }

  return (
    <div className="course-runner">
      <header className="course-runner-header">
        <div className="course-runner-brand">
          <Link aria-label="返回我的課程" href={backHref}>
            <span aria-hidden="true">←</span>
            <Image
              alt=""
              height={36}
              priority
              src="/suiyue-milk.png"
              width={36}
            />
          </Link>
          <div>
            <small>歲悅學苑數位教室</small>
            <strong>{courseTitle}</strong>
          </div>
        </div>
        <div className="course-runner-header-progress">
          <div>
            <span>{progressLabel ?? "有效觀看"}</span>
            <strong>
              {progressSummary ??
                `${confirmedMinutes}／${requiredMinutes || "—"} 分鐘`}
            </strong>
          </div>
          <div
            aria-label={`課程進度 ${progressPercent}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progressPercent}
            className="course-runner-progress-track"
            role="progressbar"
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <div className="course-runner-header-actions">
          <span className="course-runner-sync">
            <i aria-hidden="true" />
            {syncLabel}
          </span>
          <Link href="/support">需要協助</Link>
          <Link href={backHref}>離開教室</Link>
        </div>
      </header>

      {demoNotice && (
        <div className="course-runner-demo-notice" role="status">
          <strong>教室視覺示範</strong>
          <span>{demoNotice}</span>
        </div>
      )}

      <nav aria-label="手機教室選單" className="course-runner-mobile-nav">
        <button
          aria-expanded={openPanel === "tasks"}
          onClick={() =>
            setOpenPanel((current) => (current === "tasks" ? null : "tasks"))
          }
          type="button"
        >
          <span aria-hidden="true">✓</span>
          完課進度
        </button>
        <button
          aria-expanded={openPanel === "outline"}
          onClick={() =>
            setOpenPanel((current) =>
              current === "outline" ? null : "outline",
            )
          }
          type="button"
        >
          <span aria-hidden="true">☰</span>
          課程目錄
        </button>
      </nav>

      <div className="course-runner-body">
        <aside
          aria-label="完課任務"
          className={`course-runner-task-rail ${
            openPanel === "tasks" ? "is-open" : ""
          }`}
        >
          <div className="course-runner-panel-heading">
            <div>
              <span>學習任務</span>
              <strong>{progressPercent}% 完成</strong>
            </div>
            <button
              aria-label="關閉完課進度"
              onClick={() => setOpenPanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <ol>
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  aria-current={
                    task.activityId === activeActivityId ? "step" : undefined
                  }
                  className={`task-${task.state}`}
                  onClick={() => selectActivity(task.activityId)}
                  type="button"
                >
                  <span aria-hidden="true">
                    {task.state === "complete"
                      ? "✓"
                      : task.state === "attention"
                        ? "!"
                        : "•"}
                  </span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.detail}</small>
                  </span>
                  <em>{taskStateLabel(task.state)}</em>
                </button>
              </li>
            ))}
          </ol>
          <div className="course-runner-help">
            <strong>不知道下一步？</strong>
            <p>橘色項目就是目前建議完成的步驟。</p>
            <Link href="/support">聯絡客服</Link>
          </div>
        </aside>

        <aside
          aria-label="課程章節"
          className={`course-runner-curriculum ${
            openPanel === "outline" ? "is-open" : ""
          }`}
        >
          <div className="course-runner-panel-heading">
            <div>
              <span>課程內容</span>
              <strong>
                {modules.reduce(
                  (total, module) => total + module.activities.length,
                  0,
                )}{" "}
                個單元
              </strong>
            </div>
            <button
              aria-label="關閉課程目錄"
              onClick={() => setOpenPanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="course-runner-module-list">
            {modules.map((module, moduleIndex) => (
              <section key={module.id}>
                <div>
                  <span>{String(moduleIndex + 1).padStart(2, "0")}</span>
                  <h2>{module.title}</h2>
                </div>
                <ol>
                  {module.activities.map((activity) => (
                    <li key={activity.id}>
                      <button
                        aria-current={
                          activity.id === activeActivityId ? "page" : undefined
                        }
                        disabled={activity.locked}
                        onClick={() => selectActivity(activity.id)}
                        title={activity.lockReason ?? undefined}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`activity-kind kind-${activity.kind}`}
                        >
                          {activity.locked
                            ? "鎖"
                            : activity.completed
                              ? "✓"
                              : activityKindLabels[activity.kind].slice(0, 1)}
                        </span>
                        <span>
                          <strong>{activity.title}</strong>
                          <small>
                            {activity.locked && activity.lockReason
                              ? activity.lockReason
                              : activity.meta}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </aside>

        <section className="course-runner-content">{children}</section>
      </div>

      {openPanel && (
        <button
          aria-label="關閉教室選單"
          className="course-runner-scrim"
          onClick={() => setOpenPanel(null)}
          type="button"
        />
      )}

      <footer className="course-runner-footer">
        <button
          disabled={!previousActivity}
          onClick={() =>
            previousActivity && selectActivity(previousActivity.id)
          }
          type="button"
        >
          <span aria-hidden="true">←</span>
          <span>
            <small>上一單元</small>
            <strong>{previousActivity?.title ?? "已是第一個單元"}</strong>
          </span>
        </button>
        <div>
          <span>{progressPercent}%</span>
          <small>全課程進度</small>
        </div>
        <button
          disabled={!nextActivity}
          onClick={() => nextActivity && selectActivity(nextActivity.id)}
          type="button"
        >
          <span>
            <small>下一單元</small>
            <strong>{nextActivity?.title ?? "已完成所有單元"}</strong>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  );
}
