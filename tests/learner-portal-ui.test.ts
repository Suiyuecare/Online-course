import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  learnerCourseTaxonomy,
  showcaseCategories,
  showcaseCourses,
  showcaseCreditTypes,
} from "@/content/showcase-courses";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("logged-in learner portal", () => {
  it("ships the requested four-part learner navigation", () => {
    const shell = source("src/components/learner-portal-shell.tsx");
    const store = source("src/components/learner-portal-store.tsx");
    const frame = source("src/components/site-frame.tsx");

    expect(shell).toContain("課程總覽");
    expect(shell).toContain("我的課程");
    expect(shell).toContain("購物車");
    expect(shell).toContain("帳號");
    expect(shell).toContain("learner-cart-badge");
    expect(store).toContain('aria-live="polite"');
    expect(shell).toContain("學員手機選單");
    expect(frame).toContain("isLearnerPortalPath");
  });

  it("adds semantic course discovery to the logged-in header", () => {
    const shell = source("src/components/learner-portal-shell.tsx");
    const styles = source("src/app/globals.css");

    expect(shell).toContain("learnerCourseTaxonomy");
    expect(shell).toContain('<details className="learner-explore-menu">');
    expect(shell).toContain('action="/learner/catalog#official-courses"');
    expect(shell).not.toContain("/learner/catalog#course-search");
    expect(shell).toContain('method="get"');
    expect(shell).toContain('name="q"');
    expect(shell).toContain('type="search"');
    expect(shell).toContain("category=${category.code}");
    expect(shell).toContain(
      'className="learner-icon-button learner-search-button"',
    );
    expect(styles).toContain(".learner-header-course-search");
    expect(styles).toContain(".learner-header-actions .learner-search-button");
  });

  it("keeps the account drawer professional and accessible", () => {
    const shell = source("src/components/learner-portal-shell.tsx");

    for (const label of [
      "我的專業頁",
      "我的收藏",
      "結訓證明",
      "通知中心",
      "訂單紀錄",
      "我的折扣券",
      "帳號與個人資料",
      "客服中心",
    ]) {
      expect(shell).toContain(label);
    }
    expect(shell).toContain("<SignOutButton compact />");
    expect(source("src/components/sign-out-button.tsx")).toContain("登出");
    expect(shell).toContain("aria-expanded={open}");
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('event.key !== "Tab"');
    expect(shell).toContain("createPortal");
    expect(shell).not.toMatch(/Hahow Point|Money Point|回饋金|青銅旅行者/);
  });

  it("uses topic categories and statutory credit attributes separately", () => {
    expect(learnerCourseTaxonomy).toHaveLength(8);
    expect(showcaseCategories).toHaveLength(9);
    expect(showcaseCreditTypes).toEqual([
      "全部積分屬性",
      "專業課程",
      "專業品質",
      "專業倫理",
      "專業法規",
    ]);
    expect(new Set(showcaseCourses.map((course) => course.category)).size).toBe(
      8,
    );
    expect(new Set(showcaseCourses.map((course) => course.creditType))).toEqual(
      new Set(["專業課程", "專業品質", "專業倫理", "專業法規"]),
    );
  });

  it("presents the complete learner-center information hierarchy", () => {
    const dashboard = source("src/app/learner/page.tsx");

    for (const label of [
      "上課倒數",
      "我的課程",
      "結訓證明",
      "為你推薦的課程",
      "最近的訂單",
      "有效觀看",
    ]) {
      expect(dashboard).toContain(label);
    }
    expect(dashboard).toContain("Asia/Taipei");
    expect(dashboard).toContain("readLearnerCenterRows");
    expect(dashboard).toContain("readOwnOrders");
    expect(dashboard).toContain("rankCatalogRecommendations");
    expect(dashboard).toContain("catalogCourseListingWithReadiness");
    expect(dashboard).not.toContain("<ShowcaseCourseCard");
    expect(dashboard).toContain("部分學習資料暫時無法讀取");
    expect(dashboard).toContain(
      "/api/catalog/courses/${encodeURIComponent(row.course_version_id)}/cover",
    );
    expect(dashboard).toContain("unoptimized={row.has_cover}");
    expect(source("src/app/learner/certificates/page.tsx")).toContain(
      "系統不會把連線問題顯示成「沒有證明」",
    );
  });

  it("merges local carts into account storage without trusting cart prices", () => {
    const store = source("src/components/learner-portal-store.tsx");
    const cart = source("src/app/learner/cart/page.tsx");
    const layout = source("src/app/learner/layout.tsx");
    const favorites = source("src/app/learner/favorites/page.tsx");
    const favoriteView = source("src/components/learner-favorites-view.tsx");

    expect(store).toContain("accountId");
    expect(store).toContain("window.localStorage");
    expect(store).toContain("anonymousLearnerCartStorageKey");
    expect(store).toContain('operation: "merge"');
    expect(store).toContain('fetch("/api/cart"');
    expect(store).toContain("requestCartRefresh");
    expect(store).toContain("courseVersionId");
    expect(store).toContain('fetch("/api/favorites"');
    expect(store).not.toContain("candidate.favoriteSlugs");
    expect(layout).toContain("readOwnLearnerCart");
    expect(cart).toContain("正式訂單金額以伺服器結帳頁重新計算為準");
    expect(cart).toContain("每門課需個別確認");
    expect(cart).toContain("購物車同步暫時中斷");
    expect(favorites).toContain("readOwnCourseFavorites");
    expect(favoriteView).toContain("收藏不等於購買");
    expect(favoriteView).toContain("換手機登入");
    expect(favoriteView).toContain("收藏目前未開放");
    expect(favoriteView).not.toContain("<ShowcaseCourseCard");
  });

  it("only exposes cart actions after the sale readiness check passes", () => {
    const card = source("src/components/course-card.tsx");
    const catalog = source("src/infrastructure/supabase/catalog.ts");

    expect(card).toContain("course.purchase_readiness?.purchaseReady === true");
    expect(card).toContain(
      "purchaseReady && <AddOfficialCourseToCart course={course} />",
    );
    expect(card).toContain("!learnerMode && purchaseReady");
    expect(catalog).toContain("catalogCourseListingWithReadiness");
    expect(catalog).toContain('"read_public_course_readiness"');
  });
});
