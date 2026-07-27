import { DomainError } from "./feature-gates";

export function requiredAssistants(learners: number): number {
  if (!Number.isInteger(learners) || learners < 0 || learners > 200) {
    throw new DomainError("INVALID_CAPACITY", "learners must be 0..200");
  }
  if (learners <= 50) return 0;
  if (learners <= 100) return 1;
  if (learners <= 150) return 2;
  return 3;
}

export function sellableLearnerCapacity(input: {
  requestedLearnerCapacity: number;
  verifiedZoomTotalCapacity: number;
  hostSeats: number;
  cohostSeats: number;
  assistantSeats: number;
  reservedSupportSeats: number;
}): number {
  const providerCapacity =
    input.verifiedZoomTotalCapacity -
    input.hostSeats -
    input.cohostSeats -
    input.assistantSeats -
    input.reservedSupportSeats;
  const staffedCapacity =
    input.assistantSeats === 0
      ? 50
      : input.assistantSeats === 1
        ? 100
        : input.assistantSeats === 2
          ? 150
          : 200;
  return Math.max(
    0,
    Math.min(
      200,
      input.requestedLearnerCapacity,
      providerCapacity,
      staffedCapacity,
    ),
  );
}

export function attendanceResult(input: {
  scheduledTeachingSeconds: number;
  lockedBreakSeconds: number;
  presenceSeconds: number;
  freshHeartbeatSeconds: number;
  cameraOnSeconds: number;
  thresholdPercent: number;
}): {
  denominatorSeconds: number;
  effectivePresenceSeconds: number;
  presencePercent: number;
  cameraPercent: number;
  qualified: boolean;
} {
  const denominatorSeconds =
    input.scheduledTeachingSeconds - input.lockedBreakSeconds;
  if (denominatorSeconds <= 0)
    throw new DomainError("INVALID_DENOMINATOR", "invalid teaching schedule");
  const effectivePresenceSeconds = Math.min(
    input.presenceSeconds,
    input.freshHeartbeatSeconds,
    denominatorSeconds,
  );
  const presencePercent = (effectivePresenceSeconds / denominatorSeconds) * 100;
  const cameraPercent =
    (Math.min(input.cameraOnSeconds, effectivePresenceSeconds) /
      denominatorSeconds) *
    100;
  return {
    denominatorSeconds,
    effectivePresenceSeconds,
    presencePercent,
    cameraPercent,
    qualified:
      presencePercent >= input.thresholdPercent &&
      cameraPercent >= input.thresholdPercent,
  };
}

export function canSettleEvidence(endedAt: Date, now: Date): boolean {
  return now.getTime() >= endedAt.getTime() + 24 * 60 * 60_000;
}
