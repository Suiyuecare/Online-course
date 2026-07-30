import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anonymousLearnerCartStorageKey,
  deduplicateLearnerCartItems,
  learnerCartChangedEvent,
  learnerCartMutationSchema,
  mergeLearnerCartItems,
  parseLearnerCartStorage,
  serializeLearnerCartStorage,
  type LearnerCartItem,
} from "@/domain/learner-cart";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function item(
  courseVersionId: string,
  overrides: Partial<LearnerCartItem> = {},
): LearnerCartItem {
  return {
    courseVersionId,
    slug: `course-${courseVersionId.slice(0, 8)}`,
    title: "伺服器購物車測試課",
    priceTwd: 900,
    deliveryType: "recorded",
    hasCover: true,
    available: true,
    addedAt: "2026-07-30T01:00:00.000Z",
    ...overrides,
  };
}

const firstId = "a1000000-0000-4000-8000-000000000001";
const secondId = "a1000000-0000-4000-8000-000000000002";

describe("learner server cart", () => {
  it("migrates the previous local shape and rejects malformed browser data", () => {
    const parsed = parseLearnerCartStorage(
      JSON.stringify({
        cart: [
          {
            courseVersionId: firstId,
            slug: "legacy-course",
            title: "舊版購物車",
            priceTwd: 500,
            deliveryType: "recorded",
            coverUrl: `/api/catalog/courses/${firstId}/cover`,
          },
          { courseVersionId: "not-a-uuid", priceTwd: -1 },
        ],
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      courseVersionId: firstId,
      hasCover: true,
      available: true,
    });
    expect(anonymousLearnerCartStorageKey).toContain("anonymous");
  });

  it("deduplicates device and account items with authoritative data first", () => {
    const authoritative = item(firstId, { priceTwd: 900 });
    const stale = item(firstId, { priceTwd: 1 });
    const local = item(secondId);
    const merged = mergeLearnerCartItems([authoritative], [stale, local]);

    expect(merged).toHaveLength(2);
    expect(merged[0].priceTwd).toBe(900);
    expect(
      parseLearnerCartStorage(serializeLearnerCartStorage(merged)),
    ).toEqual(merged);
  });

  it("keeps overflow migration candidates separate from the 100-item UI cap", () => {
    const accountItems = Array.from({ length: 100 }, (_, index) =>
      item(`a1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
    );
    const localOnly = item("a1000000-0000-4000-8001-000000000001");

    expect(deduplicateLearnerCartItems(accountItems, [localOnly])).toHaveLength(
      101,
    );
    expect(mergeLearnerCartItems(accountItems, [localOnly])).toHaveLength(100);
  });

  it("permits bulk merge but requires exactly one id for add and remove", () => {
    expect(
      learnerCartMutationSchema.safeParse({
        operation: "merge",
        courseVersionIds: [firstId, secondId],
      }).success,
    ).toBe(true);
    expect(
      learnerCartMutationSchema.safeParse({
        operation: "add",
        courseVersionIds: [firstId, secondId],
      }).success,
    ).toBe(false);
    expect(
      learnerCartMutationSchema.safeParse({
        operation: "remove",
        courseVersionIds: [],
      }).success,
    ).toBe(false);
  });

  it("stores only version identities and rebuilds price from the catalog", () => {
    const migration = source(
      "supabase/migrations/20260730052000_learner_server_cart.sql",
    );
    expect(migration).toContain("create table public.learner_cart_items");
    expect(migration).toContain("primary key (person_id, course_version_id)");
    const cartTable =
      migration.match(
        /create table public\.learner_cart_items[\s\S]*?\n\);/,
      )?.[0] ?? "";
    expect(cartTable).not.toContain("price_twd");
    expect(migration).toContain("'priceTwd', version.price_twd");
    expect(migration).toContain("public.published_course_catalog");
    expect(migration).toContain("LEARNER_CART_COURSE_UNAVAILABLE");
    expect(migration).toContain("submitted_operation is null");
  });

  it("uses owner-only reads and narrow invoker RPCs without direct writes", () => {
    const migration = source(
      "supabase/migrations/20260730052000_learner_server_cart.sql",
    );
    expect(migration).toContain(
      "alter table public.learner_cart_items force row level security",
    );
    expect(migration).toContain("learner_cart_items_owner_read");
    expect(migration).toContain(
      "using (person_id = (select internal.request_person_id()))",
    );
    expect(migration).toContain(
      "grant select on table public.learner_cart_items to authenticated",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*?learner_cart_items[\s\S]*?to\s+authenticated/i,
    );
    expect(migration).toContain(
      "create or replace function public.sync_own_learner_cart",
    );
    const publicFunctions =
      migration.match(/create or replace function public\.[\s\S]*?\n\$\$;/g) ??
      [];
    expect(publicFunctions).not.toHaveLength(0);
    for (const block of publicFunctions) {
      expect(block).toContain("security invoker");
      expect(block).not.toContain("security definer");
    }
  });

  it("serves read and idempotent mutation APIs and removes ordered courses", () => {
    const route = source("src/app/api/cart/route.ts");
    const application = source("src/application/learner-cart.ts");
    const orderRoute = source("src/app/api/orders/route.ts");
    const legalRoute = source("src/app/api/legal/acceptances/route.ts");
    const contractPage = source("src/app/courses/[slug]/contract/page.tsx");
    const contractFlow = source("src/components/contract-purchase-flow.tsx");

    expect(route).toContain("export async function GET(request: Request)");
    expect(route).toContain("export async function POST(request: Request)");
    expect(route).toContain("private, no-store");
    expect(route).toContain("mutation(request");
    expect(route).toContain("assertExpectedAccount(request, user.id)");
    expect(route).toContain("LEARNER_ACCOUNT_VERSION_CONFLICT");
    expect(application).toContain('"read_own_learner_cart"');
    expect(application).toContain('"sync_own_learner_cart"');
    expect(application).toContain("p_course_version_ids");
    expect(application).not.toContain("p_price");
    expect(orderRoute).toContain('operation: "remove"');
    expect(orderRoute).toContain(
      "Cart cleanup is a non-financial preference update",
    );
    expect(orderRoute).toContain("assertExpectedAccount(request, user.id)");
    expect(legalRoute).toContain("assertExpectedAccount(request, user.id)");
    expect(contractPage).toContain("return { accountId, coupons: [] }");
    expect(contractFlow).toContain("removeOrderedCourseFromLocalCart");
    expect(contractFlow).toContain("anonymousLearnerCartStorageKey");
    expect(contractFlow).toContain("learnerCartCacheStorageKey(accountId)");
    expect(contractFlow).toContain("legacyLearnerPortalStorageKey(accountId)");
    expect(contractFlow).toContain('"x-suiyue-account-id": accountId ?? ""');
  });

  it("supports anonymous staging and account reconciliation in the UI", () => {
    const actions = source("src/components/learner-course-actions.tsx");
    const store = source("src/components/learner-portal-store.tsx");
    const publicCart = source("src/components/public-cart-link.tsx");
    const layout = source("src/app/learner/layout.tsx");

    expect(actions).toContain("AddPublicCourseToCart");
    expect(actions).toContain("登入後會自動合併");
    expect(actions).toContain("anonymousLearnerCartStorageKey");
    expect(actions).toContain("notifyLearnerCartChanged()");
    expect(actions).not.toContain('fetch("/api/cart"');
    expect(store).toContain("legacyLearnerPortalStorageKey");
    expect(store).toContain('operation: "merge"');
    expect(store).toContain("refreshOnFocus");
    expect(store).toContain("visibilitychange");
    expect(store).toContain("acceptServerCart");
    expect(store).toContain("cartRequestQueueRef");
    expect(store).toContain("offset += learnerCartMaximumItems");
    expect(store).toContain("rejectedLegacyItems");
    expect(store).toContain("account cache is display-only fallback data");
    expect(store).toContain('"x-suiyue-account-id": accountId');
    expect(store).toContain("incomingAnonymousItems.length === 0");
    expect(store).toContain("notifyLearnerCartChanged()");
    expect(publicCart).toContain(
      "window.addEventListener(learnerCartChangedEvent, refresh)",
    );
    expect(publicCart).toContain(
      "window.removeEventListener(learnerCartChangedEvent, refresh)",
    );
    expect(learnerCartChangedEvent).toBe("suiyue:learner-cart-changed");
    const migrationSource = store.slice(
      store.indexOf("const migrationItems"),
      store.indexOf("const fallback"),
    );
    expect(migrationSource).not.toContain("cachedItems");
    expect(layout).toContain("initialCart={cartResult.cart.items}");
  });
});
