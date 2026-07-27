import { describe, expect, it } from "vitest";
import {
  candidateSeconds,
  confirmPresence,
  presenceBlockTarget,
  type PlaybackHeartbeat,
} from "@/domain/playback";
import { assertAttemptOpen, deterministicDraw, scoreQuiz } from "@/domain/quiz";

const heartbeat = (
  changes: Partial<PlaybackHeartbeat> = {},
): PlaybackHeartbeat => ({
  sequence: 1,
  mediaPositionSeconds: 10,
  receivedAtMs: 10_000,
  playing: true,
  visible: true,
  online: true,
  leaseEpoch: 4,
  ...changes,
});

describe("server-authoritative recorded time", () => {
  it("counts at most the bounded server/media delta", () => {
    expect(
      candidateSeconds(
        heartbeat(),
        heartbeat({
          sequence: 2,
          mediaPositionSeconds: 25,
          receivedAtMs: 25_000,
        }),
        4,
      ),
    ).toBe(15);
  });

  it.each([
    ["background", { visible: false }],
    ["paused", { playing: false }],
    ["offline", { online: false }],
  ] as const)("does not count while %s", (_, state) => {
    expect(
      candidateSeconds(
        heartbeat(),
        heartbeat({
          ...state,
          sequence: 2,
          mediaPositionSeconds: 25,
          receivedAtMs: 25_000,
        }),
        4,
      ),
    ).toBe(0);
  });

  it("does not count a forward seek", () => {
    expect(
      candidateSeconds(
        heartbeat(),
        heartbeat({
          sequence: 2,
          mediaPositionSeconds: 1_000,
          receivedAtMs: 11_000,
        }),
        4,
      ),
    ).toBe(0);
  });

  it.each([
    ["returned from background", { visible: false }],
    ["resumed from pause", { playing: false }],
    ["just came back online", { online: false }],
  ] as const)("does not credit the preceding interval when %s", (_, state) => {
    expect(
      candidateSeconds(
        heartbeat(state),
        heartbeat({
          sequence: 2,
          mediaPositionSeconds: 25,
          receivedAtMs: 25_000,
        }),
        4,
      ),
    ).toBe(0);
  });

  it("rejects duplicate sequence and stale device lease", () => {
    expect(
      candidateSeconds(
        heartbeat(),
        heartbeat({ sequence: 1, receivedAtMs: 25_000 }),
        4,
      ),
    ).toBe(0);
    expect(
      candidateSeconds(
        heartbeat(),
        heartbeat({ sequence: 2, leaseEpoch: 3, receivedAtMs: 25_000 }),
        4,
      ),
    ).toBe(0);
  });

  it("triggers each 10 minute block", () => {
    expect(presenceBlockTarget(0, 599, 3_600)).toBeNull();
    expect(presenceBlockTarget(0, 600, 3_600)).toBe(600);
  });

  it("triggers the final short block", () => {
    expect(presenceBlockTarget(3_600, 299, 3_900)).toBeNull();
    expect(presenceBlockTarget(3_600, 300, 3_900)).toBe(300);
  });

  it("accepts at the 90 second boundary and rejects after it", () => {
    expect(
      confirmPresence({
        challengeExpiresAtMs: 90_000,
        confirmedAtMs: 90_000,
        consumed: false,
        blockSeconds: 600,
      }),
    ).toBe(600);
    expect(() =>
      confirmPresence({
        challengeExpiresAtMs: 90_000,
        confirmedAtMs: 90_001,
        consumed: false,
        blockSeconds: 600,
      }),
    ).toThrowError(expect.objectContaining({ code: "CHALLENGE_EXPIRED" }));
  });

  it("rejects replaying a consumed challenge", () => {
    expect(() =>
      confirmPresence({
        challengeExpiresAtMs: 90_000,
        confirmedAtMs: 80_000,
        consumed: true,
        blockSeconds: 600,
      }),
    ).toThrowError(expect.objectContaining({ code: "CHALLENGE_CONSUMED" }));
  });
});

describe("quiz rules", () => {
  it("holds the exact 79/80 boundary", () => {
    expect(scoreQuiz(7, 10)).toEqual({ score: 70, passed: false });
    expect(scoreQuiz(8, 10)).toEqual({ score: 80, passed: true });
  });

  it("rejects attempts after 30 minutes", () => {
    expect(() =>
      assertAttemptOpen(new Date(0), new Date(30 * 60_000 + 1)),
    ).toThrowError(expect.objectContaining({ code: "QUIZ_TIMEOUT" }));
  });

  it("draws exactly ten from a 20-question version", () => {
    const questions = Array.from({ length: 20 }, (_, index) => index);
    expect(deterministicDraw(questions, [0.1, 0.8, 0.3])).toHaveLength(10);
  });

  it("blocks publication/use below 20 questions", () => {
    expect(() =>
      deterministicDraw(Array.from({ length: 19 }), [0.5]),
    ).toThrowError(
      expect.objectContaining({ code: "QUESTION_BANK_TOO_SMALL" }),
    );
  });
});
