import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutCouponOptionSchema,
  learnerCouponWalletSchema,
} from "@/application/workspace";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260729013749_b2c_coupon_wallet.sql",
);

const walletFixture = {
  coupons: [
    {
      claimId: "11111111-1111-4111-8111-111111111111",
      campaignId: "22222222-2222-4222-8222-222222222222",
      title: "照護學習 85 折",
      description: "個人長照積分課程期間限定優惠",
      benefitKind: "percent_off",
      percentOffBps: 1500,
      fixedDiscountTwd: null,
      maxDiscountTwd: 500,
      minimumSubtotalTwd: 500,
      validFrom: "2026-07-29T00:00:00+08:00",
      validUntil: "2026-08-31T23:59:59+08:00",
      scopeType: "specific_course_versions",
      codeHint: "SU••••85",
      status: "available",
      claimedAt: "2026-07-29T08:00:00+08:00",
      reservation: null,
      applicableCourses: [
        {
          courseVersionId: "33333333-3333-4333-8333-333333333333",
          title: "失智照護實務",
          slug: "dementia-care",
        },
      ],
    },
  ],
  counts: { available: 1, reserved: 0, used: 0, expired: 0 },
  hasMore: false,
  nextCursor: null,
};

describe("B2C coupon database boundary", () => {
  it("default-denies every coupon table and exposes only narrow RPCs", () => {
    const normalizedMigration = migration.replace(/\s+/g, " ");
    for (const table of [
      "coupon_campaigns",
      "coupon_codes",
      "coupon_course_version_scopes",
      "coupon_claims",
      "coupon_reservations",
      "coupon_campaign_status_transitions",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `alter table public\\.${table}\\s+force row level security`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role`,
          "i",
        ),
      );
    }
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\.coupon_/i,
    );
    for (const signature of [
      "claim_coupon_code(text, uuid)",
      "read_my_coupons( text, integer, timestamptz, uuid )",
      "read_checkout_coupon_options(uuid)",
      "create_b2c_order_with_coupon( uuid, uuid, jsonb, uuid, uuid )",
    ]) {
      expect(normalizedMigration).toContain(
        `grant execute on function public.${signature} to authenticated`,
      );
    }
    expect(migration).toMatch(
      /grant execute on function public\.release_due_coupon_reservations\(integer\)\s+to service_role/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.release_due_coupon_reservations\(integer\)\s+to authenticated/,
    );
  });

  it("never stores or returns a reusable plaintext coupon code", () => {
    expect(migration).toContain("code_sha256 text not null unique");
    expect(migration).toContain("extensions.digest(normalized_code, 'sha256')");
    expect(migration).toContain(
      "left(normalized_code, 2) || '••••' || right(normalized_code, 2)",
    );
    expect(migration).not.toMatch(
      /create table public\.coupon_codes[\s\S]*?\bcode\s+text\b/i,
    );
    const walletBlock = migration.slice(
      migration.indexOf("function internal.read_my_coupons"),
      migration.indexOf(
        "function internal.coupon_quote_for_claim",
        migration.indexOf("function internal.read_my_coupons"),
      ),
    );
    expect(walletBlock).toContain("'codeHint', visible.code_hint");
    expect(walletBlock).not.toContain("'code',");
    expect(walletBlock).not.toContain("code_sha256");
  });

  it("derives ownership from the signed-in actor and locks claim limits", () => {
    expect(migration).toContain("actor uuid := internal.current_person_id()");
    expect(migration).toContain("unique (campaign_id, person_id)");
    expect(migration).toContain("unique (person_id, claim_idempotency_key)");
    expect(migration).toContain(
      "where claim.id = coupon_claim\n    and claim.person_id = actor\n  for update",
    );
    expect(migration).toContain(
      "where campaign.id = claim_row.campaign_id\n  for update",
    );
    expect(migration).toContain("campaign_row.total_claim_limit");
    expect(migration).toContain("campaign_row.total_redemption_limit");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("IDEMPOTENCY_PAYLOAD_MISMATCH");
  });
});

describe("coupon money and applicability invariants", () => {
  it("keeps the order total, item amount, bank instruction and refund split aligned", () => {
    expect(migration).toContain("subtotal_twd - discount_twd = amount_due_twd");
    expect(migration).toContain("discount_twd < subtotal_twd");
    expect(migration).toContain("greatest(submitted_subtotal_twd - 1, 0)");
    expect(migration).toContain("internal.discounted_allocation_snapshot");
    expect(migration).toContain("COUPON_ALLOCATION_TOTAL_MISMATCH");
    expect(migration).toMatch(
      /update public\.order_items[\s\S]*?amount_twd = net_amount,[\s\S]*?price_allocation_snapshot = net_allocation/,
    );
    expect(migration).toMatch(
      /update public\.bank_payment_instructions\s+set amount_twd = net_amount/,
    );
    expect(migration).toContain("'netRefundAllocations', net_allocation");
  });

  it("limits a coupon to one B2C order and enforces course, time and quota rules", () => {
    expect(migration).toContain(
      "order_id uuid not null unique references public.orders(id)",
    );
    expect(migration).toContain(
      "create unique index coupon_one_active_use_per_claim",
    );
    expect(migration).toContain("where status in ('reserved', 'redeemed')");
    expect(migration).toContain(
      "scope_type in ('all_b2c', 'specific_course_versions')",
    );
    expect(migration).toContain("course_not_applicable");
    expect(migration).toContain("minimum_not_met");
    expect(migration).toContain("redemption_limit_reached");
    expect(migration).toContain("order_result := internal.create_b2c_order(");
    expect(migration).not.toContain("create_organization_point");
  });

  it("reserves during manual transfer, releases unpaid expiry and never reopens late payment", () => {
    expect(migration).toContain("status text not null default 'reserved'");
    expect(migration).toContain("orders.transfer_due_at <= clock_timestamp()");
    expect(migration).toContain("for update of orders skip locked");
    expect(migration).toContain(
      "set status = 'released',\n          released_at = clock_timestamp()",
    );
    expect(migration).toContain("set status = 'paid_unfulfilled'");
    expect(migration).toContain(
      "coupon_reservation_released_before_late_payment",
    );
    expect(migration).not.toMatch(
      /when new\.status\s*=\s*'refunded'[\s\S]{0,300}status\s*=\s*'released'/,
    );
  });
});

describe("learner coupon API and UI contract", () => {
  it("strictly validates the safe wallet and checkout projections", () => {
    expect(learnerCouponWalletSchema.safeParse(walletFixture).success).toBe(
      true,
    );
    expect(
      learnerCouponWalletSchema.safeParse({
        ...walletFixture,
        coupons: [
          {
            ...walletFixture.coupons[0],
            plaintextCode: "SUIYUE85",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      checkoutCouponOptionSchema.safeParse({
        eligible: true,
        reason: null,
        claimId: "11111111-1111-4111-8111-111111111111",
        campaignId: "22222222-2222-4222-8222-222222222222",
        title: "照護學習 85 折",
        benefitKind: "percent_off",
        percentOffBps: 1500,
        fixedDiscountTwd: null,
        minimumSubtotalTwd: 500,
        validUntil: "2026-08-31T23:59:59+08:00",
        listPriceTwd: 1_200,
        discountTwd: 180,
        amountDueTwd: 1_020,
      }).success,
    ).toBe(true);
  });

  it("claims through an authenticated idempotent API instead of browser storage", () => {
    const route = source("src/app/api/coupons/claim/route.ts");
    const form = source("src/components/coupon-code-form.tsx");
    const page = source("src/app/learner/discounts/page.tsx");
    const workspace = source("src/application/workspace.ts");

    expect(route).toContain("requireUser()");
    expect(route).toContain("requireIdempotencyKey(request)");
    expect(route).toContain("new PlatformApplication(supabase).claimCoupon");
    expect(form).toContain('fetch("/api/coupons/claim"');
    expect(form).toContain('"idempotency-key": crypto.randomUUID()');
    expect(form).not.toMatch(/localStorage|sessionStorage/);
    expect(page).toContain("readMyCoupons(supabase");
    expect(page).toContain("系統不會用示範資料代替");
    expect(workspace).toContain('"read_my_coupons"');
  });

  it("sends only the selected claim identifier and lets the server price the order", () => {
    const contractPage = source("src/app/courses/[slug]/contract/page.tsx");
    const purchase = source("src/components/contract-purchase-flow.tsx");
    const orderRoute = source("src/app/api/orders/route.ts");
    const application = source("src/application/platform.ts");

    expect(contractPage).toContain("readCheckoutCouponOptions");
    expect(purchase).toContain("couponClaimId:");
    expect(purchase).toContain("失效時不會自動改成原價下單");
    expect(orderRoute).toContain(
      "couponClaimId: z.uuid().nullable().default(null)",
    );
    expect(orderRoute).not.toMatch(/discountTwd|amountDueTwd|subtotalTwd/);
    expect(application).toContain('"create_b2c_order_with_coupon"');
    expect(application).toContain("p_coupon_claim_id: input.couponClaimId");
  });

  it("renders real available, pending, used and expired states", () => {
    const wallet = source("src/components/learner-coupon-wallet.tsx");
    for (const label of [
      "可使用",
      "待付款",
      "已使用",
      "已失效",
      "查看使用規則",
      "前往訂單匯款",
    ]) {
      expect(wallet).toContain(label);
    }
    expect(wallet).toContain("/learner/orders/");
    expect(wallet).not.toMatch(/LINE Pay|Hahow|85折全站/);
  });
});
