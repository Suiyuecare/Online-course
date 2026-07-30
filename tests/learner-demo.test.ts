import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInitialLearnerDemoState,
  demoSecondsUntil,
  demoCartSubtotal,
  demoCouponDiscount,
  filterLearnerDemoCourses,
  formatDemoSessionTimestamp,
  getLearnerDemoCourseFilterCounts,
  getLearnerDemoCartTotal,
  learnerDemoReducer,
  nextDemoSessionTimestamp,
} from "@/app/demo/learner/learner-demo-state";
import {
  learnerDemoOrders,
  learnerDemoPurchasedCourses,
} from "@/app/demo/learner/data";
import { getAccessibleModalKeyboardAction } from "@/components/use-accessible-modal";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public learner demo route", () => {
  it("starts the guided demo with the synthetic learner center", () => {
    const hub = source("src/app/demo/page.tsx");
    const page = source("src/app/demo/learner/page.tsx");

    expect(hub).toContain('href: "/demo/learner"');
    expect(hub).toContain("從學員中心到進入教室");
    expect(page).toContain("個人學員中心操作示範");
    expect(page).toContain("index: false");
    expect(page).toContain("noarchive: true");
  });

  it("shows the complete B2C information hierarchy with synthetic data", () => {
    const demo = source("src/app/demo/learner/learner-demo.tsx");
    const accessibleModal = source("src/components/use-accessible-modal.ts");

    for (const label of [
      "安全展示模式",
      "上課倒數",
      "繼續學習",
      "課程推薦",
      "結訓證明",
      "已購買的課程紀錄",
      "我的收藏",
      "我的折扣",
      "購物車摘要",
    ]) {
      expect(demo).toContain(label);
    }

    expect(demo).toContain("林美華");
    expect(demo).toContain("0912 *** 168");
    expect(demo).toContain("合成資料，不具正式效力");
    expect(demo).toContain('aria-live="polite"');
    expect(demo).toContain('aria-modal="true"');
    expect(demo).toContain("useAccessibleModal(true, onClose)");
    expect(accessibleModal).toContain('key === "Escape"');
    expect(accessibleModal).toContain(
      'document.body.style.overflow = "hidden"',
    );
    expect(accessibleModal).toContain("previouslyFocused.focus()");
  });

  it("keeps links inside login-free demo and showcase routes", () => {
    const demo = source("src/app/demo/learner/learner-demo.tsx");

    expect(demo).toContain('href="/demo"');
    expect(demo).toContain('href="/demo/organization"');
    expect(demo).toContain(
      'href="/courses/demo/dementia-compassionate-care/classroom"',
    );
    expect(demo).toContain("href={`/courses/demo/${course.slug}`}");

    for (const protectedRoute of [
      'href="/learner',
      'href="/login',
      'href="/staff',
      'href="/organization/workspace',
      'href="/checkout',
    ]) {
      expect(demo).not.toContain(protectedRoute);
    }
  });
});

describe("learner demo interactions", () => {
  it("switches sections without navigating into authenticated pages", () => {
    const initial = createInitialLearnerDemoState();
    const courses = learnerDemoReducer(initial, {
      type: "select-view",
      view: "courses",
    });
    const saved = learnerDemoReducer(courses, {
      type: "select-view",
      view: "saved",
    });

    expect(courses.activeView).toBe("courses");
    expect(saved.activeView).toBe("saved");
    expect(saved.overlay).toBeNull();
  });

  it("filters purchased courses with stateful, data-derived counts", () => {
    const initial = createInitialLearnerDemoState();
    const counts = getLearnerDemoCourseFilterCounts(
      learnerDemoPurchasedCourses,
    );
    const upcoming = learnerDemoReducer(initial, {
      type: "select-course-filter",
      filter: "upcoming",
    });
    const filtered = filterLearnerDemoCourses(
      learnerDemoPurchasedCourses,
      upcoming.courseFilter,
    );
    const demo = source("src/app/demo/learner/learner-demo.tsx");

    expect(initial.courseFilter).toBe("all");
    expect(upcoming.courseFilter).toBe("upcoming");
    expect(counts).toEqual({
      all: 3,
      learning: 1,
      upcoming: 1,
      completed: 1,
    });
    expect(filtered.map((course) => course.status)).toEqual(["等待開課"]);
    expect(learnerDemoPurchasedCourses).toHaveLength(3);
    expect(demo).toContain('aria-label="篩選我的課程"');
    expect(demo).toContain("aria-pressed={active}");
    expect(demo).toContain("filteredPurchasedCourses.length === 0");
  });

  it("toggles synthetic favorites without mutating the initial state", () => {
    const initial = createInitialLearnerDemoState();
    const slug = initial.favoriteSlugs[0]!;
    const removed = learnerDemoReducer(initial, {
      type: "toggle-favorite",
      slug,
    });
    const restored = learnerDemoReducer(removed, {
      type: "toggle-favorite",
      slug,
    });

    expect(initial.favoriteSlugs).toContain(slug);
    expect(removed.favoriteSlugs).not.toContain(slug);
    expect(restored.favoriteSlugs).toContain(slug);
    expect(removed.notice).toContain("移除");
  });

  it("applies a coupon idempotently and only changes the demo total", () => {
    const initial = createInitialLearnerDemoState();
    const applied = learnerDemoReducer(initial, { type: "apply-coupon" });
    const appliedAgain = learnerDemoReducer(applied, {
      type: "apply-coupon",
    });

    expect(getLearnerDemoCartTotal(initial)).toBe(demoCartSubtotal);
    expect(getLearnerDemoCartTotal(applied)).toBe(
      demoCartSubtotal - demoCouponDiscount,
    );
    expect(getLearnerDemoCartTotal(appliedAgain)).toBe(
      demoCartSubtotal - demoCouponDiscount,
    );
  });

  it("opens and closes non-persistent certificate, order, and checkout previews", () => {
    let state = createInitialLearnerDemoState();

    for (const overlay of ["certificate", "order", "checkout"] as const) {
      state = learnerDemoReducer(state, {
        type: "open-overlay",
        overlay,
      });
      expect(state.overlay).toBe(overlay);

      state = learnerDemoReducer(state, { type: "close-overlay" });
      expect(state.overlay).toBeNull();
    }
  });

  it("opens the exact order selected by the learner", () => {
    const secondOrder = learnerDemoOrders[1]!;
    const state = learnerDemoReducer(createInitialLearnerDemoState(), {
      type: "open-order",
      orderNumber: secondOrder.number,
    });
    const demo = source("src/app/demo/learner/learner-demo.tsx");

    expect(state.overlay).toBe("order");
    expect(state.selectedOrderNumber).toBe(secondOrder.number);
    expect(demo).toContain("orderNumber: order.number");
    expect(demo).toContain("order={selectedOrder}");
    expect(demo).toContain("<strong>{order.number}</strong>");
  });

  it("derives the demo countdown and displayed date from one future target", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");
    const target = nextDemoSessionTimestamp(now);

    expect(target).toBe(Date.parse("2026-08-03T01:00:00.000Z"));
    expect(formatDemoSessionTimestamp(target)).toBe("2026/08/03（一）09:00");
    expect(demoSecondsUntil(target, now)).toBe(4 * 86400 + 3600);
    expect(demoSecondsUntil(target, target + 1)).toBe(0);
  });

  it("closes and traps keyboard focus inside accessible demo modals", () => {
    expect(
      getAccessibleModalKeyboardAction({
        activeIndex: 1,
        focusableCount: 3,
        key: "Escape",
        shiftKey: false,
      }),
    ).toBe("close");
    expect(
      getAccessibleModalKeyboardAction({
        activeIndex: 2,
        focusableCount: 3,
        key: "Tab",
        shiftKey: false,
      }),
    ).toBe("focus-first");
    expect(
      getAccessibleModalKeyboardAction({
        activeIndex: 0,
        focusableCount: 3,
        key: "Tab",
        shiftKey: true,
      }),
    ).toBe("focus-last");
    expect(
      getAccessibleModalKeyboardAction({
        activeIndex: -1,
        focusableCount: 0,
        key: "Tab",
        shiftKey: false,
      }),
    ).toBe("focus-dialog");
  });
});
