import { describe, expect, it } from "vitest";
import {
  attendanceResult,
  canSettleEvidence,
  requiredAssistants,
  sellableLearnerCapacity,
} from "@/domain/live";
import { validateRequirementGraph } from "@/domain/hybrid";

describe("Zoom capacity and assistants", () => {
  it.each([
    [50, 0],
    [51, 1],
    [100, 1],
    [101, 2],
    [150, 2],
    [151, 3],
    [200, 3],
  ])("requires %i learners => %i assistants", (learners, assistants) => {
    expect(requiredAssistants(learners)).toBe(assistants);
  });

  it("subtracts every staff/support seat from Zoom total capacity", () => {
    expect(
      sellableLearnerCapacity({
        requestedLearnerCapacity: 200,
        verifiedZoomTotalCapacity: 200,
        hostSeats: 1,
        cohostSeats: 1,
        assistantSeats: 3,
        reservedSupportSeats: 2,
      }),
    ).toBe(193);
  });

  it("limits capacity to the configured assistant band", () => {
    expect(
      sellableLearnerCapacity({
        requestedLearnerCapacity: 200,
        verifiedZoomTotalCapacity: 500,
        hostSeats: 1,
        cohostSeats: 0,
        assistantSeats: 1,
        reservedSupportSeats: 0,
      }),
    ).toBe(100);
  });
});

describe("evidence-based attendance", () => {
  it("uses the locked denominator minus only locked breaks", () => {
    expect(
      attendanceResult({
        scheduledTeachingSeconds: 3_600,
        lockedBreakSeconds: 600,
        presenceSeconds: 3_000,
        freshHeartbeatSeconds: 3_000,
        cameraOnSeconds: 3_000,
        thresholdPercent: 80,
      }).denominatorSeconds,
    ).toBe(3_000);
  });

  it("holds the camera 79.9/80 boundary", () => {
    expect(
      attendanceResult({
        scheduledTeachingSeconds: 1_000,
        lockedBreakSeconds: 0,
        presenceSeconds: 1_000,
        freshHeartbeatSeconds: 1_000,
        cameraOnSeconds: 799,
        thresholdPercent: 80,
      }).qualified,
    ).toBe(false);
    expect(
      attendanceResult({
        scheduledTeachingSeconds: 1_000,
        lockedBreakSeconds: 0,
        presenceSeconds: 1_000,
        freshHeartbeatSeconds: 1_000,
        cameraOnSeconds: 800,
        thresholdPercent: 80,
      }).qualified,
    ).toBe(true);
  });

  it("intersects provider presence with fresh client heartbeat", () => {
    expect(
      attendanceResult({
        scheduledTeachingSeconds: 1_000,
        lockedBreakSeconds: 0,
        presenceSeconds: 900,
        freshHeartbeatSeconds: 700,
        cameraOnSeconds: 900,
        thresholdPercent: 80,
      }).effectivePresenceSeconds,
    ).toBe(700);
  });

  it("waits the full 24-hour settlement window", () => {
    const ended = new Date("2026-01-01T00:00:00Z");
    expect(canSettleEvidence(ended, new Date("2026-01-01T23:59:59.999Z"))).toBe(
      false,
    );
    expect(canSettleEvidence(ended, new Date("2026-01-02T00:00:00Z"))).toBe(
      true,
    );
  });
});

describe("hybrid requirement graph", () => {
  it("accepts an in-version DAG with a completion path", () => {
    expect(() =>
      validateRequirementGraph(
        [
          { id: "recorded", required: true },
          { id: "live-a", required: true },
          { id: "live-b", required: true },
        ],
        [
          { from: "recorded", to: "live-a" },
          { from: "live-a", to: "live-b" },
        ],
      ),
    ).not.toThrow();
  });

  it("rejects a cycle", () => {
    expect(() =>
      validateRequirementGraph(
        [
          { id: "a", required: true },
          { id: "b", required: true },
        ],
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      ),
    ).toThrowError(expect.objectContaining({ code: "NO_GRAPH_START" }));
  });

  it("rejects a cross-version/missing node edge", () => {
    expect(() =>
      validateRequirementGraph(
        [{ id: "a", required: true }],
        [{ from: "a", to: "other-version" }],
      ),
    ).toThrowError(expect.objectContaining({ code: "CROSS_VERSION_EDGE" }));
  });

  it("rejects duplicate requirement nodes", () => {
    expect(() =>
      validateRequirementGraph(
        [
          { id: "same", required: true },
          { id: "same", required: true },
        ],
        [],
      ),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_NODE" }));
  });
});
