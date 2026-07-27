import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import {
  recordedPlaybackAuthorizationSchema,
  rewindOriginResponse,
} from "@/app/api/playback/_shared/authorization";
import {
  playbackTokenTtlSeconds,
  streamAdapter,
} from "@/infrastructure/adapters/stream";
import { requireUser } from "@/infrastructure/supabase/server";

const requestSchema = z.object({
  enrollmentId: z.uuid(),
  playbackSessionId: z.uuid(),
  leaseEpoch: z.number().int().nonnegative(),
  lessonVideoVersionId: z.uuid(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, requestSchema);
    const { data, error } = await supabase.rpc("refresh_recorded_playback", {
      p_enrollment_id: input.enrollmentId,
      p_playback_session_id: input.playbackSessionId,
      p_lease_epoch: input.leaseEpoch,
      p_lesson_video_version_id: input.lessonVideoVersionId,
    });
    const authorization = recordedPlaybackAuthorizationSchema.safeParse(data);
    if (
      error ||
      !authorization.success ||
      authorization.data.enrollment_id !== input.enrollmentId
    ) {
      throw new Error("PLAYBACK_REFRESH_NOT_AUTHORIZED");
    }
    if (authorization.data.rewind_origin_required) {
      return rewindOriginResponse(authorization.data);
    }
    const tokenTtlSeconds = playbackTokenTtlSeconds(
      authorization.data.duration_seconds,
    );
    return {
      status: "authorized" as const,
      enrollmentId: authorization.data.enrollment_id,
      playbackToken: streamAdapter().createPlaybackToken(
        authorization.data.video_uid,
        authorization.data.duration_seconds,
      ),
      playbackExpiresAt: new Date(
        Date.now() + tokenTtlSeconds * 1000,
      ).toISOString(),
      playbackSessionId: authorization.data.playback_session_id,
      leaseEpoch: authorization.data.lease_epoch,
      overlay: authorization.data.watermark_text,
      challengeRequired: authorization.data.challenge_required,
      challengeToken: authorization.data.challenge_token,
      challengeTimedOut: authorization.data.challenge_timed_out,
      challengeExpiresAt: authorization.data.challenge_expires_at,
      challengeOriginLessonId: authorization.data.challenge_origin_lesson_id,
      challengeOriginVideoVersionId:
        authorization.data.challenge_origin_video_version_id,
      challengeOriginPositionSeconds:
        authorization.data.challenge_origin_position_seconds,
      rewindToSeconds: authorization.data.rewind_to_seconds,
      resumeAtSeconds: authorization.data.resume_at_seconds,
      capabilityNotice:
        "畫面姓名是可見提示，不是鑑識浮水印，無法完全阻止螢幕錄影。",
    };
  });
}
