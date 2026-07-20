import { describe, expect, it } from "vitest";
import { accreditationQualification } from "./accreditation";

const complete = {
  courseApproved: true,
  registrationStatus: "verified",
  progressPercent: 90,
  completionPercent: 90,
  quizPassed: true,
  satisfactionCompleted: true,
  satisfactionRequired: true,
  enrollmentStatus: "completed",
};

describe("accreditationQualification", () => {
  it("qualifies only when every formal-credit gate passes", () => {
    expect(accreditationQualification(complete)).toEqual({
      qualified: true,
      reasons: [],
    });
  });

  it("returns operationally useful exception reasons", () => {
    const result = accreditationQualification({
      ...complete,
      courseApproved: false,
      registrationStatus: "needs_correction",
      progressPercent: 70,
      quizPassed: false,
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons).toEqual([
      "課程尚未取得核定",
      "積分資料需要補正",
      "有效觀看未達 90%",
      "課後測驗尚未通過",
    ]);
  });
});
