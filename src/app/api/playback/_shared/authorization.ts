import { z } from "zod";

const rewindOriginRequiredSchema = z.object({
  rewind_origin_required: z.literal(true),
  enrollment_id: z.uuid(),
  challenge_timed_out: z.boolean(),
  challenge_origin_lesson_id: z.uuid(),
  challenge_origin_video_version_id: z.uuid(),
  challenge_origin_position_seconds: z.number().nonnegative(),
  rewind_fence_active: z.literal(true),
  rewind_to_seconds: z.number().nonnegative(),
});

const playableAuthorizationSchema = z.object({
  rewind_origin_required: z.literal(false),
  enrollment_id: z.uuid(),
  video_uid: z.string().min(1),
  duration_seconds: z.number().int().positive(),
  playback_session_id: z.uuid(),
  lease_epoch: z.number().int().nonnegative(),
  watermark_text: z.string(),
  challenge_required: z.boolean(),
  challenge_token: z.string().nullable(),
  challenge_timed_out: z.boolean(),
  challenge_expires_at: z.iso.datetime({ offset: true }).nullable(),
  challenge_origin_lesson_id: z.uuid().nullable(),
  challenge_origin_video_version_id: z.uuid().nullable(),
  challenge_origin_position_seconds: z.number().nonnegative().nullable(),
  rewind_to_seconds: z.number().nonnegative().nullable(),
  resume_at_seconds: z.number().nonnegative().nullable(),
});

export const recordedPlaybackAuthorizationSchema = z.discriminatedUnion(
  "rewind_origin_required",
  [rewindOriginRequiredSchema, playableAuthorizationSchema],
);

export type RecordedPlaybackAuthorization = z.infer<
  typeof recordedPlaybackAuthorizationSchema
>;

export function rewindOriginResponse(
  authorization: Extract<
    RecordedPlaybackAuthorization,
    { rewind_origin_required: true }
  >,
) {
  return {
    status: "rewind_origin_required" as const,
    enrollmentId: authorization.enrollment_id,
    challengeTimedOut: authorization.challenge_timed_out,
    challengeOriginLessonId: authorization.challenge_origin_lesson_id,
    challengeOriginVideoVersionId:
      authorization.challenge_origin_video_version_id,
    challengeOriginPositionSeconds:
      authorization.challenge_origin_position_seconds,
    rewindToSeconds: authorization.rewind_to_seconds,
  };
}
