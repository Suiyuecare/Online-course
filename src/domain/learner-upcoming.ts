export type LearnerUpcomingSource = {
  enrollment_id: string;
  delivery_type: "recorded" | "live" | "hybrid";
  next_live_starts_at: string | null;
  content_available_at: string | null;
};

export type LearnerUpcomingEvent<T extends LearnerUpcomingSource> = {
  kind: "content_release" | "live";
  startsAt: string;
  row: T;
};

export function learnerUpcomingEvents<T extends LearnerUpcomingSource>(
  rows: T[],
  now = Date.now(),
): LearnerUpcomingEvent<T>[] {
  return rows
    .flatMap((row) => {
      const events: LearnerUpcomingEvent<T>[] = [];
      if (
        row.content_available_at &&
        row.delivery_type !== "live" &&
        Date.parse(row.content_available_at) > now
      ) {
        events.push({
          kind: "content_release",
          startsAt: row.content_available_at,
          row,
        });
      }
      if (
        row.next_live_starts_at &&
        Date.parse(row.next_live_starts_at) > now
      ) {
        events.push({
          kind: "live",
          startsAt: row.next_live_starts_at,
          row,
        });
      }
      return events;
    })
    .sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
    );
}

export function isLearnerContentWaiting(
  contentAvailableAt: string | null,
  now = Date.now(),
): boolean {
  return Boolean(contentAvailableAt && Date.parse(contentAvailableAt) > now);
}
