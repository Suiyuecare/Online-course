export type AttendanceEvent = {
  eventType: "joined" | "left" | "heartbeat";
  occurredAt: string;
  cameraOn?: boolean;
};
export type BreakInterval = { startsAt: string; endsAt: string };

function overlapSeconds(
  start: number,
  end: number,
  ranges: Array<[number, number]>,
) {
  return ranges.reduce(
    (sum, [rangeStart, rangeEnd]) =>
      sum +
      Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / 1000,
    0,
  );
}

export function calculateLiveAttendance(input: {
  startsAt: string;
  endsAt: string;
  breaks: BreakInterval[];
  events: AttendanceEvent[];
  thresholdPercent?: number;
  cameraSecondsDelta?: number;
}) {
  const classStart = Date.parse(input.startsAt);
  const classEnd = Date.parse(input.endsAt);
  const breaks = input.breaks.map(
    (item) =>
      [Date.parse(item.startsAt), Date.parse(item.endsAt)] as [number, number],
  );
  const denominator = Math.max(
    0,
    Math.round(
      (classEnd - classStart) / 1000 -
        overlapSeconds(classStart, classEnd, breaks),
    ),
  );
  const ordered = [...input.events].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  let joined = false;
  let previousHeartbeat: number | null = null;
  let previousCameraOn = false;
  let cameraSeconds = 0;
  let onlineSeconds = 0;
  for (const event of ordered) {
    const occurred = Date.parse(event.occurredAt);
    if (event.eventType === "joined") {
      joined = true;
      previousHeartbeat = null;
      previousCameraOn = false;
      continue;
    }
    if (event.eventType === "left") {
      joined = false;
      previousHeartbeat = null;
      previousCameraOn = false;
      continue;
    }
    if (!joined || event.eventType !== "heartbeat") continue;
    if (previousHeartbeat !== null) {
      const segmentStart = Math.max(classStart, previousHeartbeat);
      const segmentEnd = Math.min(classEnd, occurred);
      const gap = (occurred - previousHeartbeat) / 1000;
      if (gap > 0 && gap <= 45 && segmentEnd > segmentStart) {
        const credited = Math.max(
          0,
          Math.round(
            (segmentEnd - segmentStart) / 1000 -
              overlapSeconds(segmentStart, segmentEnd, breaks),
          ),
        );
        onlineSeconds += credited;
        if (previousCameraOn && event.cameraOn) cameraSeconds += credited;
      }
    }
    previousHeartbeat = occurred;
    previousCameraOn = Boolean(event.cameraOn);
  }
  cameraSeconds = Math.max(
    0,
    Math.min(denominator, cameraSeconds + (input.cameraSecondsDelta ?? 0)),
  );
  onlineSeconds = Math.max(cameraSeconds, Math.min(denominator, onlineSeconds));
  const percent = denominator ? (cameraSeconds / denominator) * 100 : 0;
  const threshold = input.thresholdPercent ?? 80;
  return {
    denominatorSeconds: denominator,
    onlineSeconds,
    cameraSeconds,
    cameraPercent: percent,
    qualified: percent + Number.EPSILON >= threshold,
  };
}
