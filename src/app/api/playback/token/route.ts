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

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const { enrollmentId, lessonVideoVersionId } = await readJson(
      request,
      z.object({
        enrollmentId: z.uuid(),
        lessonVideoVersionId: z.uuid(),
      }),
    );
    const { data, error } = await supabase.rpc("authorize_recorded_playback", {
      p_enrollment_id: enrollmentId,
      p_lesson_video_version_id: lessonVideoVersionId,
    });
    const parsed = recordedPlaybackAuthorizationSchema.safeParse(data);
    if (
      error ||
      !parsed.success ||
      parsed.data.enrollment_id !== enrollmentId
    ) {
      throw new Error("PLAYBACK_NOT_AUTHORIZED");
    }
    const authorization = parsed.data;
    if (authorization.rewind_origin_required) {
      return rewindOriginResponse(authorization);
    }
    const tokenTtlSeconds = playbackTokenTtlSeconds(
      authorization.duration_seconds,
    );
    return {
      status: "authorized" as const,
      enrollmentId: authorization.enrollment_id,
      playbackToken: streamAdapter().createPlaybackToken(
        authorization.video_uid,
        authorization.duration_seconds,
      ),
      playbackExpiresAt: new Date(
        Date.now() + tokenTtlSeconds * 1000,
      ).toISOString(),
      playbackSessionId: authorization.playback_session_id,
      leaseEpoch: authorization.lease_epoch,
      overlay: authorization.watermark_text,
      challengeRequired: authorization.challenge_required,
      challengeToken: authorization.challenge_token,
      challengeTimedOut: authorization.challenge_timed_out,
      challengeExpiresAt: authorization.challenge_expires_at,
      challengeOriginLessonId: authorization.challenge_origin_lesson_id,
      challengeOriginVideoVersionId:
        authorization.challenge_origin_video_version_id,
      challengeOriginPositionSeconds:
        authorization.challenge_origin_position_seconds,
      rewindToSeconds: authorization.rewind_to_seconds,
      resumeAtSeconds: authorization.resume_at_seconds,
      capabilityNotice:
        "畫面姓名是可見提示，不是鑑識浮水印，無法完全阻止螢幕錄影。",
    };
  });
}
