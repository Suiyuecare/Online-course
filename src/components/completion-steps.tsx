"use client";

import { QuizActivity } from "@/components/quiz-activity";
import { SurveyActivity } from "@/components/survey-activity";

export function CompletionSteps({ enrollmentId }: { enrollmentId: string }) {
  return (
    <div className="completion-steps">
      <QuizActivity enrollmentId={enrollmentId} initiallyPassed={false} />
      <SurveyActivity enrollmentId={enrollmentId} initiallyCompleted={false} />
    </div>
  );
}
