import { describe, expect, it } from "vitest";
import {
  calculateLiveAttendance,
  type AttendanceEvent,
} from "./live-attendance";

const start = "2026-08-01T01:00:00.000Z";
const at = (seconds: number) =>
  new Date(Date.parse(start) + seconds * 1000).toISOString();
function cameraEvents(lastSecond: number): AttendanceEvent[] {
  const events: AttendanceEvent[] = [
    { eventType: "joined", occurredAt: at(0) },
    { eventType: "heartbeat", occurredAt: at(0), cameraOn: true },
  ];
  for (let second = 40; second < lastSecond; second += 40)
    events.push({
      eventType: "heartbeat",
      occurredAt: at(second),
      cameraOn: true,
    });
  events.push({
    eventType: "heartbeat",
    occurredAt: at(lastSecond),
    cameraOn: true,
  });
  return events;
}

describe("live attendance", () => {
  it("keeps 79.9% disqualified and accepts 80%", () => {
    const base = {
      startsAt: start,
      endsAt: at(1000),
      breaks: [],
      thresholdPercent: 80,
    };
    expect(
      calculateLiveAttendance({ ...base, events: cameraEvents(799) }).qualified,
    ).toBe(false);
    expect(
      calculateLiveAttendance({ ...base, events: cameraEvents(800) }).qualified,
    ).toBe(true);
  });

  it("excludes formal breaks from the denominator and credited time", () => {
    const result = calculateLiveAttendance({
      startsAt: start,
      endsAt: at(600),
      breaks: [{ startsAt: at(240), endsAt: at(360) }],
      events: cameraEvents(480),
      thresholdPercent: 100,
    });
    expect(result.denominatorSeconds).toBe(480);
    expect(result.cameraSeconds).toBe(360);
  });

  it("does not credit a heartbeat gap over 45 seconds", () => {
    const result = calculateLiveAttendance({
      startsAt: start,
      endsAt: at(120),
      breaks: [],
      events: [
        { eventType: "joined", occurredAt: at(0) },
        { eventType: "heartbeat", occurredAt: at(0), cameraOn: true },
        { eventType: "heartbeat", occurredAt: at(60), cameraOn: true },
      ],
      thresholdPercent: 1,
    });
    expect(result.cameraSeconds).toBe(0);
    expect(result.qualified).toBe(false);
  });
});
