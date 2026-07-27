import { describe, expect, it } from "vitest";

type Outcome = {
  quizScore: number | null;
  quizPassed: boolean;
  certificateStatus: string | null;
};

type Snapshot = {
  lifecycleRevision: number;
  visibilityCutoffAt: number;
  capturedAt: number;
  outcome: Outcome;
};

type Correction = {
  lifecycleRevision: number;
  createdAt: number;
  outcome: Partial<Outcome>;
};

function visibleInactiveOutcome(
  snapshots: Snapshot[],
  corrections: Correction[],
): Outcome | null {
  const snapshot = [...snapshots].sort(
    (left, right) =>
      right.lifecycleRevision - left.lifecycleRevision ||
      right.capturedAt - left.capturedAt,
  )[0];
  if (!snapshot) return null;
  const correction = corrections
    .filter(
      (candidate) =>
        candidate.lifecycleRevision === snapshot.lifecycleRevision &&
        candidate.createdAt >= snapshot.visibilityCutoffAt,
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  return { ...snapshot.outcome, ...(correction?.outcome ?? {}) };
}

describe("organization-funded quality correction lifecycle", () => {
  it("applies a correction only to the inactive snapshot lifecycle it belongs to", () => {
    const snapshotA: Snapshot = {
      lifecycleRevision: 2,
      visibilityCutoffAt: 100,
      capturedAt: 100,
      outcome: {
        quizScore: 80,
        quizPassed: true,
        certificateStatus: "active",
      },
    };
    const correctionA: Correction = {
      lifecycleRevision: 2,
      createdAt: 110,
      outcome: {
        quizScore: null,
        quizPassed: false,
        certificateStatus: "revoked",
      },
    };

    expect(visibleInactiveOutcome([snapshotA], [correctionA])).toEqual({
      quizScore: null,
      quizPassed: false,
      certificateStatus: "revoked",
    });
  });

  it("does not overlay offboarding A correction C onto later offboarding B", () => {
    const snapshotA: Snapshot = {
      lifecycleRevision: 2,
      visibilityCutoffAt: 100,
      capturedAt: 100,
      outcome: {
        quizScore: 80,
        quizPassed: true,
        certificateStatus: "active",
      },
    };
    const correctionC: Correction = {
      lifecycleRevision: 2,
      createdAt: 110,
      outcome: {
        quizScore: null,
        quizPassed: false,
        certificateStatus: "revoked",
      },
    };
    const snapshotB: Snapshot = {
      lifecycleRevision: 4,
      visibilityCutoffAt: 200,
      capturedAt: 200,
      outcome: {
        quizScore: 90,
        quizPassed: true,
        certificateStatus: "active",
      },
    };

    expect(
      visibleInactiveOutcome([snapshotA, snapshotB], [correctionC]),
    ).toEqual(snapshotB.outcome);
  });

  it("does not reveal a correction recorded before the selected snapshot cutoff", () => {
    const snapshot: Snapshot = {
      lifecycleRevision: 2,
      visibilityCutoffAt: 100,
      capturedAt: 100,
      outcome: {
        quizScore: 80,
        quizPassed: true,
        certificateStatus: "active",
      },
    };
    const preCutoffCorrection: Correction = {
      lifecycleRevision: 2,
      createdAt: 99,
      outcome: {
        quizScore: 100,
        quizPassed: true,
        certificateStatus: "credited",
      },
    };

    expect(visibleInactiveOutcome([snapshot], [preCutoffCorrection])).toEqual(
      snapshot.outcome,
    );
  });
});
