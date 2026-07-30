import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("digital classroom course runner", () => {
  it("uses dedicated classroom chrome for learner and showcase routes", () => {
    const frame = source("src/components/site-frame.tsx");
    const layout = source("src/app/layout.tsx");

    expect(layout).toContain("<SiteFrame>");
    expect(frame).toContain("/learner\\/courses\\/");
    expect(frame).toContain("/courses\\/demo\\/");
    expect(frame).toContain('className="classroom-site-main"');
  });

  it("renders every learner activity inside one course runner", () => {
    const runner = source("src/components/learner-course-runner.tsx");

    expect(runner).toContain("<CourseRunnerFrame");
    expect(runner).toContain("<RecordedClassroom");
    expect(runner).toContain("<CourseMaterialDownloadButton");
    expect(runner).toContain("<QuizActivity");
    expect(runner).toContain("<SurveyActivity");
    expect(runner).toContain("<AccreditationIdentitySection");
    expect(runner).toContain("<LiveBookingCard");
    expect(runner).toContain("<CertificateDownloadButton");
  });

  it("shows authoritative playback sync and presence state", () => {
    const classroom = source("src/components/recorded-classroom.tsx");

    expect(classroom).toContain("candidateSeconds");
    expect(classroom).toContain("confirmedSeconds");
    expect(classroom).toContain("最後同步");
    expect(classroom).toContain("每 15 秒同步");
    expect(classroom).toContain("在席確認");
    expect(classroom).not.toContain('window.confirm(\n        "開始播放後');
  });

  it("restores an unfinished quiz on the same device", () => {
    const quiz = source("src/components/quiz-activity.tsx");

    expect(quiz).toContain("window.localStorage.getItem");
    expect(quiz).toContain("window.localStorage.setItem");
    expect(quiz).toContain("questionIndex");
    expect(quiz).toContain("已恢復這台裝置上尚未交卷的測驗");
  });

  it("exposes a public no-credit classroom preview", () => {
    const detail = source("src/components/showcase-course-detail.tsx");
    const runner = source("src/components/showcase-course-runner.tsx");
    const page = source("src/app/courses/demo/[slug]/classroom/page.tsx");

    expect(detail).toContain("進入數位教室示範");
    expect(runner).toContain("公開影片只用來展示教室操作");
    expect(runner).toContain("不保存進度");
    expect(page).toContain("<ShowcaseCourseRunner");
  });

  it("clears parent completion state when a demo quiz or survey restarts", () => {
    const runner = source("src/components/showcase-course-runner.tsx");
    const quiz = source("src/components/showcase-quiz-preview.tsx");
    const survey = source("src/components/showcase-survey-preview.tsx");

    expect(quiz).toContain("onReset?.()");
    expect(survey).toContain("onReset?.()");
    expect(runner).toContain("onReset={() => setQuizScore(null)}");
    expect(runner).toContain("onReset={() => setSurveyCompleted(false)}");
    expect(runner).toContain("score={quizScore}");
    expect(runner).toContain("completed={surveyCompleted}");
    expect(quiz).not.toContain("setScore");
    expect(survey).not.toContain("setCompleted");
  });

  it("closes the demo completion loop without writing formal records", () => {
    const runner = source("src/components/showcase-course-runner.tsx");

    expect(runner).toContain('certificateActivityId = "demo-certificate"');
    expect(runner).toContain("completionEligible");
    expect(runner).toContain("載入完整合成成果");
    expect(runner).toContain("合成證明可預覽");
    expect(runner).toContain("不寫入資料庫");
    expect(runner).toContain("disabled={presenceConfirmed}");
    expect(runner).toContain("useAccessibleModal");
    expect(runner).toContain(
      'liveAttendanceComplete\n            ? "合成簽到退已完成"',
    );
  });

  it("shares the current Suiyue orange palette and navigation treatment", () => {
    const styles = source("src/app/globals.css");

    for (const token of [
      "--orange: #ea880c",
      "--orange-dark: #b45309",
      "--orange-soft: #f2c78e",
      "--orange-wash: #fff0dc",
      "--terracotta: #96501c",
      "--page: #fff9f2",
      "--cream: #fffdf8",
      "--cream-deep: #ffe7c2",
      "--ink: #2f2a26",
      "--muted: #6e6259",
      "--line: #f1cfa8",
      "--classroom-rail: #433a33",
      "--classroom-rail-deep: #2f2925",
      "--navy: var(--classroom-rail)",
      "--navy-deep: var(--classroom-rail-deep)",
    ]) {
      expect(styles).toContain(token);
    }
    expect(styles).toContain(".course-runner-task-rail {");
    expect(styles).toContain("var(--navy) 0%");
    expect(styles).toContain("var(--navy-deep) 100%");
  });
});
