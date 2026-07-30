export type LearnerDemoView = "overview" | "courses" | "records" | "saved";

export type LearnerDemoOverlay = "certificate" | "order" | "checkout" | null;

export type LearnerDemoCourseFilter =
  | "all"
  | "learning"
  | "upcoming"
  | "completed";

export type LearnerDemoState = {
  activeView: LearnerDemoView;
  courseFilter: LearnerDemoCourseFilter;
  favoriteSlugs: string[];
  couponApplied: boolean;
  overlay: LearnerDemoOverlay;
  selectedOrderNumber: string | null;
  notice: string | null;
};

export type LearnerDemoAction =
  | { type: "select-view"; view: LearnerDemoView }
  | { type: "select-course-filter"; filter: LearnerDemoCourseFilter }
  | { type: "toggle-favorite"; slug: string }
  | { type: "apply-coupon" }
  | { type: "open-order"; orderNumber: string }
  | { type: "open-overlay"; overlay: Exclude<LearnerDemoOverlay, null> }
  | { type: "close-overlay" }
  | { type: "clear-notice" };

export const demoCartSubtotal = 680;
export const demoCouponDiscount = 100;
const taipeiOffsetMs = 8 * 60 * 60 * 1000;
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function nextDemoSessionTimestamp(now: number) {
  const taipeiNow = new Date(now + taipeiOffsetMs);
  const weekday = taipeiNow.getUTCDay();
  let daysUntilMonday = (8 - weekday) % 7;
  const isPastMondayStart =
    weekday === 1 &&
    (taipeiNow.getUTCHours() > 9 ||
      (taipeiNow.getUTCHours() === 9 &&
        (taipeiNow.getUTCMinutes() > 0 ||
          taipeiNow.getUTCSeconds() > 0 ||
          taipeiNow.getUTCMilliseconds() > 0)));

  if (isPastMondayStart) {
    daysUntilMonday = 7;
  }

  return Date.UTC(
    taipeiNow.getUTCFullYear(),
    taipeiNow.getUTCMonth(),
    taipeiNow.getUTCDate() + daysUntilMonday,
    1,
  );
}

export function formatDemoSessionTimestamp(timestamp: number) {
  const taipeiDate = new Date(timestamp + taipeiOffsetMs);
  const year = taipeiDate.getUTCFullYear();
  const month = String(taipeiDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipeiDate.getUTCDate()).padStart(2, "0");
  const hour = String(taipeiDate.getUTCHours()).padStart(2, "0");
  const minute = String(taipeiDate.getUTCMinutes()).padStart(2, "0");
  const weekday = weekdayLabels[taipeiDate.getUTCDay()];
  return `${year}/${month}/${day}（${weekday}）${hour}:${minute}`;
}

export function demoSecondsUntil(timestamp: number, now: number) {
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

export function createInitialLearnerDemoState(): LearnerDemoState {
  return {
    activeView: "overview",
    courseFilter: "all",
    favoriteSlugs: [
      "swallowing-and-mealtime-safety",
      "stroke-spasticity-home-rehab",
    ],
    couponApplied: false,
    overlay: null,
    selectedOrderNumber: null,
    notice: null,
  };
}

export function filterLearnerDemoCourses<T extends { status: string }>(
  courses: readonly T[],
  filter: LearnerDemoCourseFilter,
): T[] {
  if (filter === "all") return [...courses];

  const expectedStatus = {
    learning: "學習中",
    upcoming: "等待開課",
    completed: "已完成",
  }[filter];

  return courses.filter((course) => course.status === expectedStatus);
}

export function getLearnerDemoCourseFilterCounts<T extends { status: string }>(
  courses: readonly T[],
): Record<LearnerDemoCourseFilter, number> {
  const counts: Record<LearnerDemoCourseFilter, number> = {
    all: courses.length,
    learning: 0,
    upcoming: 0,
    completed: 0,
  };

  for (const course of courses) {
    if (course.status === "學習中") counts.learning += 1;
    if (course.status === "等待開課") counts.upcoming += 1;
    if (course.status === "已完成") counts.completed += 1;
  }

  return counts;
}

export function getLearnerDemoCartTotal(state: LearnerDemoState): number {
  return Math.max(
    0,
    demoCartSubtotal - (state.couponApplied ? demoCouponDiscount : 0),
  );
}

export function learnerDemoReducer(
  state: LearnerDemoState,
  action: LearnerDemoAction,
): LearnerDemoState {
  switch (action.type) {
    case "select-view":
      return {
        ...state,
        activeView: action.view,
        notice: null,
      };
    case "select-course-filter":
      return {
        ...state,
        courseFilter: action.filter,
      };
    case "toggle-favorite": {
      const isFavorite = state.favoriteSlugs.includes(action.slug);

      return {
        ...state,
        favoriteSlugs: isFavorite
          ? state.favoriteSlugs.filter((slug) => slug !== action.slug)
          : [...state.favoriteSlugs, action.slug],
        notice: isFavorite ? "已從示範收藏移除" : "已加入示範收藏",
      };
    }
    case "apply-coupon":
      if (state.couponApplied) {
        return {
          ...state,
          notice: "安心進修券已套用在示範購物車",
        };
      }

      return {
        ...state,
        couponApplied: true,
        notice: "已套用安心進修券，示範金額折抵 NT$100",
      };
    case "open-order":
      return {
        ...state,
        overlay: "order",
        selectedOrderNumber: action.orderNumber,
        notice: null,
      };
    case "open-overlay":
      return {
        ...state,
        overlay: action.overlay,
        notice: null,
      };
    case "close-overlay":
      return {
        ...state,
        overlay: null,
      };
    case "clear-notice":
      return {
        ...state,
        notice: null,
      };
  }
}
