import { z } from "zod";

export const liveBreakIntervalSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (interval) => Date.parse(interval.endsAt) > Date.parse(interval.startsAt),
    {
      message: "BREAK_END_MUST_FOLLOW_START",
    },
  );

export const liveBreakIntervalsSchema = z
  .array(liveBreakIntervalSchema)
  .max(20)
  .superRefine((intervals, context) => {
    const ordered = [...intervals].sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (
        Date.parse(ordered[index]!.startsAt) <
        Date.parse(ordered[index - 1]!.endsAt)
      ) {
        context.addIssue({
          code: "custom",
          message: "BREAK_INTERVALS_OVERLAP",
        });
        return;
      }
    }
  });

export function breaksFitTeachingWindow(input: {
  startsAt: string;
  endsAt: string;
  breakIntervals: { startsAt: string; endsAt: string }[];
}) {
  const courseStart = Date.parse(input.startsAt);
  const courseEnd = Date.parse(input.endsAt);
  return input.breakIntervals.every(
    (interval) =>
      Date.parse(interval.startsAt) >= courseStart &&
      Date.parse(interval.endsAt) <= courseEnd,
  );
}

export function totalBreakSeconds(
  intervals: { startsAt: string; endsAt: string }[],
) {
  return intervals.reduce(
    (total, interval) =>
      total +
      (Date.parse(interval.endsAt) - Date.parse(interval.startsAt)) / 1000,
    0,
  );
}
