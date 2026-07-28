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
});
