import type { LearnerCenterRow } from "@/application/learner-center";

export const learnerCourseStatusFilters = [
  { value: "all", label: "全部狀態" },
  { value: "learning", label: "學習中" },
  { value: "upcoming", label: "即將開始" },
  { value: "completed", label: "已完成" },
  { value: "needs_attention", label: "需要處理" },
] as const;

export const learnerCourseDeliveryFilters = [
  { value: "all", label: "全部授課形式" },
  { value: "recorded", label: "預錄課" },
  { value: "live", label: "直播課" },
  { value: "hybrid", label: "混合課" },
] as const;

export const learnerCourseSortOptions = [
  { value: "recommended", label: "建議順序（預設）" },
  { value: "title", label: "課程名稱" },
  { value: "progress", label: "完成度由高到低" },
  { value: "nearest", label: "最近期限或開課時間" },
] as const;

export type LearnerCourseStatusFilter =
  (typeof learnerCourseStatusFilters)[number]["value"];
export type LearnerCourseDeliveryFilter =
  (typeof learnerCourseDeliveryFilters)[number]["value"];
export type LearnerCourseSort =
  (typeof learnerCourseSortOptions)[number]["value"];

export type LearnerCourseLibraryQuery = {
  query: string;
  status: LearnerCourseStatusFilter;
  delivery: LearnerCourseDeliveryFilter;
  sort: LearnerCourseSort;
};

type SearchParam = string | string[] | undefined;

const completedStatuses = new Set(["completed", "submitted", "credited"]);
const attentionStatuses = new Set(["needs_correction", "rejected", "revoked"]);

function firstParam(value: SearchParam): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function validOption<T extends string>(
  value: SearchParam,
  options: ReadonlyArray<{ value: T }>,
  fallback: T,
): T {
  const candidate = firstParam(value);
  return options.some((option) => option.value === candidate)
    ? (candidate as T)
    : fallback;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function learnerCourseProgress(row: LearnerCenterRow): number {
  return Math.min(
    100,
    Math.round(
      (row.confirmed_valid_seconds / Math.max(row.required_seconds, 1)) * 100,
    ),
  );
}

export function isLearnerCourseUpcoming(
  row: LearnerCenterRow,
  now = Date.now(),
): boolean {
  if (completedStatuses.has(row.enrollment_status)) return false;
  const contentAvailableAt = timestamp(row.content_available_at);
  const nextLiveStartsAt = timestamp(row.next_live_starts_at);
  return Boolean(
    (contentAvailableAt !== null && contentAvailableAt > now) ||
      (nextLiveStartsAt !== null && nextLiveStartsAt > now),
  );
}

export function learnerCourseNeedsAttention(
  row: LearnerCenterRow,
  now = Date.now(),
): boolean {
  if (attentionStatuses.has(row.enrollment_status)) return true;
  if (completedStatuses.has(row.enrollment_status)) return false;
  const completionDueAt = timestamp(row.completion_due_at);
  return completionDueAt !== null && completionDueAt < now;
}

function nearestCourseMilestone(row: LearnerCenterRow): number {
  const candidates = [
    timestamp(row.completion_due_at),
    timestamp(row.content_available_at),
    timestamp(row.next_live_starts_at),
  ].filter((value): value is number => value !== null);
  return candidates.length > 0 ? Math.min(...candidates) : Number.MAX_VALUE;
}

function matchesStatus(
  row: LearnerCenterRow,
  status: LearnerCourseStatusFilter,
  now: number,
): boolean {
  if (status === "all") return true;
  if (status === "completed") {
    return completedStatuses.has(row.enrollment_status);
  }
  if (status === "upcoming") return isLearnerCourseUpcoming(row, now);
  if (status === "needs_attention") {
    return learnerCourseNeedsAttention(row, now);
  }
  return row.enrollment_status === "active";
}

export function parseLearnerCourseLibraryQuery(input: {
  q?: SearchParam;
  status?: SearchParam;
  delivery?: SearchParam;
  sort?: SearchParam;
}): LearnerCourseLibraryQuery {
  return {
    query: firstParam(input.q).trim().slice(0, 120),
    status: validOption(input.status, learnerCourseStatusFilters, "all"),
    delivery: validOption(input.delivery, learnerCourseDeliveryFilters, "all"),
    sort: validOption(input.sort, learnerCourseSortOptions, "recommended"),
  };
}

export function hasLearnerCourseLibraryFilters(
  query: LearnerCourseLibraryQuery,
): boolean {
  return (
    query.query.length > 0 ||
    query.status !== "all" ||
    query.delivery !== "all" ||
    query.sort !== "recommended"
  );
}

export function filterLearnerCourseLibrary(
  rows: LearnerCenterRow[],
  query: LearnerCourseLibraryQuery,
  now = Date.now(),
): LearnerCenterRow[] {
  const normalizedSearch = query.query.toLocaleLowerCase("zh-TW");

  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      if (
        normalizedSearch &&
        !row.course_title.toLocaleLowerCase("zh-TW").includes(normalizedSearch)
      ) {
        return false;
      }
      if (query.delivery !== "all" && row.delivery_type !== query.delivery) {
        return false;
      }
      return matchesStatus(row, query.status, now);
    })
    .sort((left, right) => {
      if (query.sort === "title") {
        return (
          left.row.course_title.localeCompare(
            right.row.course_title,
            "zh-Hant",
          ) || left.index - right.index
        );
      }
      if (query.sort === "progress") {
        return (
          learnerCourseProgress(right.row) - learnerCourseProgress(left.row) ||
          left.index - right.index
        );
      }
      if (query.sort === "nearest") {
        return (
          nearestCourseMilestone(left.row) -
            nearestCourseMilestone(right.row) || left.index - right.index
        );
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
