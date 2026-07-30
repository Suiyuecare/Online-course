import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("learner payment record", () => {
  it("uses the signed-in learner's owner-scoped order details and fails closed", () => {
    const page = source(
      "src/app/learner/orders/[orderId]/payment-record/page.tsx",
    );

    expect(page).toContain("requireUser()");
    expect(page).toContain(".orderDetails(orderId)");
    expect(page).toContain('redirect("/login")');
    expect(page).toContain('error.message.includes("ORDER_NOT_FOUND")');
    expect(page).toContain("order.amountPaidTwd <= 0");
    expect(page).toContain("!order.paidAt");
    expect(page).toContain("notFound()");
    expect(page).toContain("目前無法安全讀取付款紀錄");
    expect(page).not.toContain("serviceSupabase");
  });

  it("shows only the required non-tax payment acknowledgement fields", () => {
    const page = source(
      "src/app/learner/orders/[orderId]/payment-record/page.tsx",
    );

    for (const label of [
      "歲悅學苑",
      "付款紀錄，非統一發票／電子發票",
      "訂單編號",
      "付款確認日期",
      "付款方式",
      "銀行帳號匯款",
      "課程原價",
      "折扣",
      "實際付款",
      "退款調整說明",
    ]) {
      expect(page).toContain(label);
    }

    expect(page).toContain("order.orderNumber");
    expect(page).toContain("order.courseTitle");
    expect(page).toContain("order.subtotalTwd");
    expect(page).toContain("order.discountTwd");
    expect(page).toContain("order.amountPaidTwd");
    expect(page).not.toMatch(
      /order\.(?:bankName|bankCode|accountName|accountNumber|maskedAccount)/,
    );
  });

  it("links paid orders from both detail and history and supports clean printing", () => {
    const detail = source("src/app/learner/orders/[orderId]/page.tsx");
    const history = source("src/components/learner-order-history.tsx");
    const printButton = source(
      "src/components/payment-record-print-button.tsx",
    );
    const styles = source("src/app/globals.css");

    expect(detail).toContain("/payment-record");
    expect(detail).toContain("檢視／列印付款紀錄");
    expect(history).toContain("/payment-record");
    expect(history).toContain("order.paidAt && order.amountPaidTwd > 0");
    expect(printButton).toContain('"use client"');
    expect(printButton).toContain("window.print()");
    expect(styles).toContain("@media print");
    expect(styles).toContain(".payment-record-actions");
    expect(styles).toContain(".learner-portal-header");
    expect(styles).toContain("size: A4");
  });
});
