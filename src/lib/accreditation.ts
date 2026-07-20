export type AccreditationCheck = {
  courseApproved: boolean;
  registrationStatus: string | null;
  progressPercent: number;
  completionPercent: number;
  quizPassed: boolean;
  satisfactionCompleted: boolean;
  satisfactionRequired: boolean;
  enrollmentStatus: string;
};

export function accreditationQualification(check: AccreditationCheck) {
  const reasons: string[] = [];
  if (!check.courseApproved) reasons.push("課程尚未取得核定");
  if (check.registrationStatus !== "verified")
    reasons.push(
      check.registrationStatus === "needs_correction"
        ? "積分資料需要補正"
        : "積分身分資料尚未驗證",
    );
  if (check.progressPercent < check.completionPercent)
    reasons.push(`有效觀看未達 ${check.completionPercent}%`);
  if (!check.quizPassed) reasons.push("課後測驗尚未通過");
  if (check.satisfactionRequired && !check.satisfactionCompleted)
    reasons.push("滿意度尚未完成");
  if (!["active", "completed"].includes(check.enrollmentStatus))
    reasons.push("修課資格目前無效");
  return { qualified: reasons.length === 0, reasons };
}
