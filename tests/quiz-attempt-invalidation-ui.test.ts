import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  learnerQuizInvalidationStatusSchema,
  quizAttemptInvalidationWorkspaceSchema,
} from "@/application/quiz-attempt-invalidation";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const attemptId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

describe("quiz-attempt invalidation projections", () => {
  it("accepts masked attempt and request metadata without quiz answers", () => {
    expect(
      quizAttemptInvalidationWorkspaceSchema.safeParse({
        attempts: [
          {
            id: attemptId,
            enrollmentId,
            learnerLabel: "王○明",
            courseLabel: "長照積分課程",
            attemptNumber: 2,
            status: "passed",
            score: 90,
            passingScore: 80,
            submittedAt: "2026-07-24T06:00:00Z",
            hasOpenRequest: false,
          },
        ],
        requests: [
          {
            id: requestId,
            quizAttemptId: attemptId,
            learnerLabel: "王○明",
            courseLabel: "長照積分課程",
            attemptNumber: 2,
            score: 90,
            status: "pending_review",
            requestedAt: "2026-07-24T06:10:00Z",
            requesterLabel: "審核員 A",
            requestReason: "監考紀錄顯示本次測驗需作廢。",
            decidedAt: null,
            decidedByLabel: null,
            decisionReason: null,
            canReview: true,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("fails closed if a staff projection includes raw responses", () => {
    const parsed = quizAttemptInvalidationWorkspaceSchema.safeParse({
      attempts: [
        {
          id: attemptId,
          enrollmentId,
          learnerLabel: "王○明",
          courseLabel: "長照積分課程",
          attemptNumber: 2,
          status: "passed",
          score: 90,
          passingScore: 80,
          submittedAt: "2026-07-24T06:00:00Z",
          hasOpenRequest: false,
          responses: [{ itemId: "answer-leak" }],
        },
      ],
      requests: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("fails closed if the learner projection exposes staff identity", () => {
    const parsed = learnerQuizInvalidationStatusSchema.safeParse([
      {
        attemptId,
        attemptNumber: 2,
        score: 90,
        status: "voided",
        requestStatus: "approved",
        requestedAt: "2026-07-24T06:10:00Z",
        decidedAt: "2026-07-24T06:20:00Z",
        reason: "覆核後確認作廢。",
        reviewerLabel: "不應公開的審核員",
      },
    ]);
    expect(parsed.success).toBe(false);
  });
});

describe("quiz-attempt invalidation workflow UI", () => {
  it("uses guided selections and distinct request/decision handlers", () => {
    const panel = source("src/components/quiz-attempt-invalidation-panel.tsx");
    const requestRoute = source(
      "src/app/api/staff/accreditation/quiz-attempt-invalidations/route.ts",
    );
    const decisionRoute = source(
      "src/app/api/staff/accreditation/quiz-attempt-invalidations/[requestId]/decision/route.ts",
    );
    const unsafeIdInput =
      /<input\b[^>]*\bname="(?:quizAttemptId|requestId|enrollmentId)"/;

    expect(panel).toContain('<select\n                name="quizAttemptId"');
    expect(panel).not.toMatch(unsafeIdInput);
    expect(panel).toContain("提案人不能核准自己的案件");
    expect(panel.match(/obtainStepUp\(/g)).toHaveLength(2);
    expect(panel.match(/"accreditation_result"/g)).toHaveLength(2);
    expect(requestRoute).toContain('"request_quiz_attempt_invalidation"');
    expect(requestRoute).toContain("requireIdempotencyKey(request)");
    expect(requestRoute).toContain('createHash("sha256")');
    expect(decisionRoute).toContain('"decide_quiz_attempt_invalidation"');
    expect(decisionRoute).toContain(
      "p_idempotency_key: requireIdempotencyKey(request)",
    );
    expect(decisionRoute).toContain('z.enum(["approve", "reject"])');
    expect(decisionRoute).toContain('createHash("sha256")');
  });

  it("protects the page with the accreditation reviewer role", () => {
    const page = source(
      "src/app/staff/accreditation/quiz-invalidation/page.tsx",
    );
    expect(page).toContain('p_required_role: "accreditation_reviewer"');
    expect(page).toContain("readQuizAttemptInvalidationWorkspace(supabase)");
    expect(page).toContain("不會讀取學員的原始作答內容");
  });
});
