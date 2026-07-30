import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLearnerContentWaiting,
  learnerUpcomingEvents,
} from "@/domain/learner-upcoming";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("learner course content release", () => {
  it("orders recorded releases and live starts without inventing past events", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");
    const events = learnerUpcomingEvents(
      [
        {
          enrollment_id: "recorded",
          delivery_type: "recorded" as const,
          content_available_at: "2026-08-02T01:00:00.000Z",
          next_live_starts_at: null,
        },
        {
          enrollment_id: "hybrid",
          delivery_type: "hybrid" as const,
          content_available_at: "2026-07-31T01:00:00.000Z",
          next_live_starts_at: "2026-08-05T01:00:00.000Z",
        },
        {
          enrollment_id: "past",
          delivery_type: "recorded" as const,
          content_available_at: "2026-07-29T01:00:00.000Z",
          next_live_starts_at: null,
        },
      ],
      now,
    );

    expect(
      events.map((event) => [
        event.row.enrollment_id,
        event.kind,
        event.startsAt,
      ]),
    ).toEqual([
      ["hybrid", "content_release", "2026-07-31T01:00:00.000Z"],
      ["recorded", "content_release", "2026-08-02T01:00:00.000Z"],
      ["hybrid", "live", "2026-08-05T01:00:00.000Z"],
    ]);
    expect(isLearnerContentWaiting("2026-07-31T01:00:00.000Z", now)).toBe(true);
    expect(isLearnerContentWaiting("2026-07-29T01:00:00.000Z", now)).toBe(
      false,
    );
    expect(isLearnerContentWaiting(null, now)).toBe(false);
  });

  it("enforces release time in every server-authoritative learning path", () => {
    const migration = source(
      "supabase/migrations/20260730043000_course_content_release_gates.sql",
    );

    expect(migration).toContain("COURSE_CONTENT_RELEASE_REQUIRED");
    expect(migration).toContain("COURSE_CONTENT_NOT_AVAILABLE");
    expect(migration).toContain(
      "internal.assert_enrollment_content_available(target_enrollment)",
    );
    expect(migration).toContain(
      "authorize_recorded_playback_without_content_release_gate",
    );
    expect(migration).toContain(
      "record_playback_heartbeat_without_content_release_gate",
    );
    expect(migration).toContain(
      "confirm_presence_challenge_without_content_release_gate",
    );
    expect(migration).toContain(
      "start_quiz_attempt_without_content_release_gate",
    );
    expect(migration).toContain(
      "submit_quiz_attempt_without_content_release_gate",
    );
    expect(migration).toContain("submit_survey_without_content_release_gate");
    expect(migration).toContain(
      "read_learner_runtime_gates_without_content_release_gate",
    );
    expect(migration).toContain(
      "version.content_available_at <= clock_timestamp()",
    );
    expect(migration).toContain(
      "'lockReason', '課程尚未開放，請依開課倒數時間再回來'",
    );
  });

  it("projects the release time and renders honest learner countdown states", () => {
    const learnerCenter = source("src/application/learner-center.ts");
    const dashboard = source("src/app/learner/page.tsx");
    const workspace = source("src/application/workspace.ts");
    const runner = source("src/components/learner-course-runner.tsx");

    expect(learnerCenter).toContain("content_available_at");
    expect(dashboard).toContain("learnerUpcomingEvents");
    expect(dashboard).toContain("查看開課倒數");
    expect(workspace).toContain("contentAvailableAt");
    expect(workspace).toContain('"課程尚未開放，請依開課倒數時間再回來"');
    expect(runner).toContain("這門課已購買，內容尚未開放");
    expect(runner).toContain("releaseBlockedActivity");
  });
});
