import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const quizAttemptOptionSchema = z
  .object({
    id: z.uuid(),
    enrollmentId: z.uuid(),
    learnerLabel: z.string().min(1),
    courseLabel: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    status: z.string().min(1),
    score: z.number().int().min(0).max(100).nullable(),
    passingScore: z.number().int().min(0).max(100),
    submittedAt: z.string().nullable(),
    hasOpenRequest: z.boolean(),
  })
  .strict();

const quizAttemptInvalidationRequestSchema = z
  .object({
    id: z.uuid(),
    quizAttemptId: z.uuid(),
    learnerLabel: z.string().min(1),
    courseLabel: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    score: z.number().int().min(0).max(100).nullable(),
    status: z.string().min(1),
    requestedAt: z.string(),
    requesterLabel: z.string().min(1),
    requestReason: z.string().min(1),
    decidedAt: z.string().nullable(),
    decidedByLabel: z.string().nullable(),
    decisionReason: z.string().nullable(),
    canReview: z.boolean(),
  })
  .strict();

export const quizAttemptInvalidationWorkspaceSchema = z
  .object({
    attempts: z.array(quizAttemptOptionSchema).max(200),
    requests: z.array(quizAttemptInvalidationRequestSchema).max(200),
  })
  .strict();

export type QuizAttemptInvalidationWorkspace = z.infer<
  typeof quizAttemptInvalidationWorkspaceSchema
>;

export const learnerQuizInvalidationStatusSchema = z
  .array(
    z
      .object({
        attemptId: z.uuid(),
        attemptNumber: z.number().int().positive(),
        score: z.number().int().min(0).max(100).nullable(),
        status: z.string().min(1),
        requestStatus: z.string().nullable(),
        requestedAt: z.string().nullable(),
        decidedAt: z.string().nullable(),
        reason: z.string().nullable(),
      })
      .strict(),
  )
  .max(100);

export type LearnerQuizInvalidationStatus = z.infer<
  typeof learnerQuizInvalidationStatusSchema
>;

export async function readQuizAttemptInvalidationWorkspace(
  client: SupabaseClient,
): Promise<QuizAttemptInvalidationWorkspace> {
  const { data, error } = await client.rpc(
    "read_quiz_attempt_invalidation_workspace",
  );
  if (error) throw new Error("QUIZ_INVALIDATION_WORKSPACE_UNAVAILABLE");
  const parsed = quizAttemptInvalidationWorkspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("QUIZ_INVALIDATION_WORKSPACE_INVALID");
  return parsed.data;
}

export async function readOwnQuizInvalidationStatuses(
  client: SupabaseClient,
  enrollmentId: string,
): Promise<LearnerQuizInvalidationStatus> {
  const { data, error } = await client.rpc(
    "read_my_quiz_attempt_invalidation_statuses",
    { p_enrollment_id: enrollmentId },
  );
  if (error) throw new Error("QUIZ_INVALIDATION_STATUS_UNAVAILABLE");
  const parsed = learnerQuizInvalidationStatusSchema.safeParse(data);
  if (!parsed.success) throw new Error("QUIZ_INVALIDATION_STATUS_INVALID");
  return parsed.data;
}
