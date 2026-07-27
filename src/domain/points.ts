import { DomainError } from "./feature-gates";

export type PointLot = {
  id: string;
  available: number;
  purchasedAt: Date;
};

export function allocateOldestLots(
  lots: PointLot[],
  requested: number,
): { lotId: string; points: number }[] {
  if (!Number.isInteger(requested) || requested <= 0)
    throw new DomainError("INVALID_POINTS", "points must be positive integers");
  const result: { lotId: string; points: number }[] = [];
  let remaining = requested;
  for (const lot of [...lots].sort(
    (a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime(),
  )) {
    if (lot.available <= 0) continue;
    const points = Math.min(remaining, lot.available);
    result.push({ lotId: lot.id, points });
    remaining -= points;
    if (remaining === 0) return result;
  }
  throw new DomainError(
    "INSUFFICIENT_POINTS",
    "wallet has insufficient points",
  );
}

export function pointConsumptionTrigger(input: {
  delivery: "recorded" | "live" | "hybrid";
  validRecordedSegmentStarted: boolean;
  liveCutoffReached: boolean;
  checkedIn: boolean;
}): boolean {
  if (input.delivery === "recorded") return input.validRecordedSegmentStarted;
  if (input.delivery === "live")
    return input.liveCutoffReached || input.checkedIn;
  return (
    input.validRecordedSegmentStarted ||
    input.liveCutoffReached ||
    input.checkedIn
  );
}
