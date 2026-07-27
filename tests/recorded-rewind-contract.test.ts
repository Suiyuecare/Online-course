import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  recordedPlaybackAuthorizationSchema,
  rewindOriginResponse,
} from "@/app/api/playback/_shared/authorization";

const originLessonId = "11111111-1111-4111-8111-111111111111";
const originVideoVersionId = "22222222-2222-4222-8222-222222222222";
const enrollmentId = "33333333-3333-4333-8333-333333333333";

describe("recorded rewind authorization contract", () => {
  it("maps a committed cross-lesson rewind directive without playback material", () => {
    const parsed = recordedPlaybackAuthorizationSchema.parse({
      rewind_origin_required: true,
      enrollment_id: enrollmentId,
      challenge_timed_out: true,
      challenge_origin_lesson_id: originLessonId,
      challenge_origin_video_version_id: originVideoVersionId,
      challenge_origin_position_seconds: 123.5,
      rewind_fence_active: true,
      rewind_to_seconds: 123.5,
      video_uid: null,
      duration_seconds: null,
      playback_session_id: null,
      lease_epoch: null,
    });

    expect(parsed.rewind_origin_required).toBe(true);
    if (!parsed.rewind_origin_required) {
      throw new Error("expected rewind directive");
    }
    expect(rewindOriginResponse(parsed)).toEqual({
      status: "rewind_origin_required",
      enrollmentId,
      challengeTimedOut: true,
      challengeOriginLessonId: originLessonId,
      challengeOriginVideoVersionId: originVideoVersionId,
      challengeOriginPositionSeconds: 123.5,
      rewindToSeconds: 123.5,
    });
  });

  it("requires complete signed-playback material for an authorized result", () => {
    expect(
      recordedPlaybackAuthorizationSchema.safeParse({
        rewind_origin_required: false,
        enrollment_id: enrollmentId,
        video_uid: null,
        duration_seconds: null,
        playback_session_id: null,
        lease_epoch: null,
      }).success,
    ).toBe(false);
  });

  it("handles the typed directive in token refresh and learner navigation", () => {
    const tokenRoute = readFileSync(
      join(process.cwd(), "src", "app", "api", "playback", "token", "route.ts"),
      "utf8",
    );
    const refreshRoute = readFileSync(
      join(
        process.cwd(),
        "src",
        "app",
        "api",
        "playback",
        "refresh",
        "route.ts",
      ),
      "utf8",
    );
    const classroom = readFileSync(
      join(process.cwd(), "src", "components", "recorded-classroom.tsx"),
      "utf8",
    );

    expect(tokenRoute).toContain("if (authorization.rewind_origin_required)");
    expect(refreshRoute).toContain(
      "if (authorization.data.rewind_origin_required)",
    );
    expect(classroom).toContain(
      'payload?.data?.status === "rewind_origin_required"',
    );
    expect(classroom).toContain("applyRewindOriginRequired(payload.data)");
    expect(classroom).toContain("window.location.assign(");
  });
});
