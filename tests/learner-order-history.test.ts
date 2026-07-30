import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { learnerOrderHistorySchema } from "@/application/workspace";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const safeHistory = {
  orders: [
    {
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNumber: "SY202607281234",
      status: "paid",
      effectiveStatus: "paid",
      displayCategory: "completed",
      paymentMethod: "manual_bank_transfer",
      subtotalTwd: 1400,
      discountTwd: 200,
      amountDueTwd: 1200,
      amountPaidTwd: 1200,
      transferDueAt: "2026-07-31T10:00:00+08:00",
      paidAt: "2026-07-29T10:00:00+08:00",
      createdAt: "2026-07-28T10:00:00+08:00",
      items: [
        {
          courseVersionId: "22222222-2222-4222-8222-222222222222",
          courseSlug: "dementia-care",
          courseTitle: "失智照護實務",
          deliveryType: "recorded",
          amountTwd: 1200,
          hasCover: true,
          enrollmentId: "33333333-3333-4333-8333-333333333333",
          enrollmentStatus: "active",
          entitlementStatus: "active",
        },
      ],
      refundCases: [],
      coupon: {
        title: "照護學習優惠",
        status: "redeemed",
        discountTwd: 200,
      },
    },
  ],
  counts: {
    all: 1,
    actionRequired: 0,
    reviewing: 0,
    completed: 1,
    closedRefund: 0,
  },
  hasMore: false,
  nextCursor: null,
};

describe("learner order history", () => {
  it("accepts the approved projection and rejects unexpected sensitive fields", () => {
    expect(learnerOrderHistorySchema.safeParse(safeHistory).success).toBe(true);
    expect(
      learnerOrderHistorySchema.safeParse({
        ...safeHistory,
        orders: [
          {
            ...safeHistory.orders[0],
            accountDetailsCiphertext: { ciphertext: "must-not-leak" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses real manual-transfer states instead of copying Hahow payment labels", () => {
    const view = source("src/components/learner-order-history.tsx");
    for (const label of [
      "全部訂單",
      "待我處理",
      "核對中",
      "已付款",
      "失效／退款",
      "銀行帳號匯款",
      "查看明細",
    ]) {
      expect(view).toContain(label);
    }
    expect(view).not.toMatch(/LINE Pay|兌換紀錄|AI Coding|Canva/);
    expect(view).toContain("Asia/Taipei");
    expect(view).toContain("/api/catalog/courses/");
  });

  it("reads only the signed-in learner projection and paginates stable ties", () => {
    const page = source("src/app/learner/orders/page.tsx");
    const application = source("src/application/workspace.ts");
    const migration = source(
      "supabase/migrations/20260728163345_learner_order_history.sql",
    );
    const indexes = source(
      "supabase/migrations/20260728165303_learner_order_history_indexes.sql",
    );

    expect(page).toContain("requireUser()");
    expect(page).toContain("readOwnOrderHistory");
    expect(page).not.toContain("serviceSupabase");
    expect(application).toContain('"read_own_order_history"');
    expect(migration).toContain("where orders.person_id = actor");
    expect(migration).toContain(
      "(classified.created_at, classified.id)\n          < (before_created_at, before_order_id)",
    );
    expect(migration).toContain("'refundCases'");
    expect(migration).not.toMatch(
      /account_details_ciphertext|remitter_name|account_last_five|quarantine_object_path/,
    );
    expect(migration).toContain(
      "grant execute on function public.read_own_order_history",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.read_own_order_history[\s\S]*?to anon/,
    );
    expect(indexes).toContain("orders_person_created_id_idx");
    expect(indexes).toContain("refund_cases_order_submitted_id_idx");
    expect(indexes).toContain("refund_allocations_case_idx");
  });

  it("keeps details inside the learner portal and fails closed on refunds", () => {
    const detail = source("src/app/learner/orders/[orderId]/page.tsx");
    const legacy = source("src/app/orders/[orderId]/page.tsx");

    expect(legacy).toContain("redirect(`/learner/orders/${orderId}`)");
    expect(detail).toContain(
      'const acceptsPaymentProof = effectiveStatus === "pending_transfer"',
    );
    expect(detail).toContain("const effectiveStatus = order.effectiveStatus");
    expect(detail).toContain('refund.status !== "rejected"');
    expect(detail).toContain("refundableScopes === undefined");
    expect(detail).toContain("系統不會先假設整張訂單可以退款");
    expect(detail).not.toContain('label: "整張訂單"');
  });
});
