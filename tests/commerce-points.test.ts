import { describe, expect, it } from "vitest";
import {
  activeAllocationTotal,
  assertRefundCap,
  b2cPaymentNeedsSecondReview,
  paymentMatch,
  recordedRefundAmount,
} from "@/domain/money";
import { allocateOldestLots, pointConsumptionTrigger } from "@/domain/points";

describe("manual bank allocation", () => {
  it("classifies underpayment without unlocking", () => {
    expect(
      paymentMatch({
        orderAmountTwd: 1_000,
        transactionAmountTwd: 800,
        transactionAllocations: [{ amountTwd: 800, reversed: false }],
        orderAllocations: [{ amountTwd: 800, reversed: false }],
      }),
    ).toBe("underpaid");
  });

  it("matches split payments only at exact total", () => {
    expect(
      paymentMatch({
        orderAmountTwd: 1_000,
        transactionAmountTwd: 600,
        transactionAllocations: [{ amountTwd: 600, reversed: false }],
        orderAllocations: [
          { amountTwd: 600, reversed: false },
          { amountTwd: 400, reversed: false },
        ],
      }),
    ).toBe("matched");
  });

  it("detects an overpaid order", () => {
    expect(
      paymentMatch({
        orderAmountTwd: 1_000,
        transactionAmountTwd: 1_100,
        transactionAllocations: [{ amountTwd: 1_100, reversed: false }],
        orderAllocations: [{ amountTwd: 1_100, reversed: false }],
      }),
    ).toBe("overpaid");
  });

  it("rejects allocating more than the immutable bank transaction", () => {
    expect(() =>
      paymentMatch({
        orderAmountTwd: 2_000,
        transactionAmountTwd: 1_000,
        transactionAllocations: [{ amountTwd: 1_001, reversed: false }],
        orderAllocations: [{ amountTwd: 1_001, reversed: false }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TRANSACTION_OVERALLOCATED" }),
    );
  });

  it("represents corrections as reversal events", () => {
    expect(
      activeAllocationTotal([
        { amountTwd: 1_000, reversed: false },
        { amountTwd: 1_000, reversed: true },
        { amountTwd: 900, reversed: false },
      ]),
    ).toBe(900);
  });
});

describe("consumer-favorable refunds", () => {
  it("refunds fully before recorded learning starts", () => {
    expect(
      recordedRefundAmount({
        allocationTwd: 999,
        confirmedValidSeconds: 0,
        requiredSeconds: 3_600,
      }),
    ).toBe(999);
  });

  it("rounds a proportional refund up for the consumer", () => {
    expect(
      recordedRefundAmount({
        allocationTwd: 1_000,
        confirmedValidSeconds: 1,
        requiredSeconds: 3,
      }),
    ).toBe(667);
  });

  it("never refunds more than actual payment cumulatively", () => {
    expect(() => assertRefundCap(1_000, 800, 201)).toThrowError(
      expect.objectContaining({ code: "REFUND_EXCEEDS_PAYMENT" }),
    );
  });

  it("fails B2C closed when the high-value threshold is missing", () => {
    expect(() =>
      b2cPaymentNeedsSecondReview({
        amountTwd: 1,
        relatedParty: false,
        thresholdTwd: null,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "FINANCE_THRESHOLD_MISSING" }),
    );
  });

  it("requires a second reviewer for threshold and related-party cases", () => {
    expect(
      b2cPaymentNeedsSecondReview({
        amountTwd: 10_000,
        relatedParty: false,
        thresholdTwd: 10_000,
      }),
    ).toBe(true);
    expect(
      b2cPaymentNeedsSecondReview({
        amountTwd: 100,
        relatedParty: true,
        thresholdTwd: 10_000,
      }),
    ).toBe(true);
  });
});

describe("non-expiring organization point lots", () => {
  const lots = [
    { id: "new", available: 500, purchasedAt: new Date("2026-02-01") },
    { id: "old", available: 300, purchasedAt: new Date("2026-01-01") },
  ];

  it("reserves oldest available lots first", () => {
    expect(allocateOldestLots(lots, 450)).toEqual([
      { lotId: "old", points: 300 },
      { lotId: "new", points: 150 },
    ]);
  });

  it("fails rather than create a negative wallet", () => {
    expect(() => allocateOldestLots(lots, 801)).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_POINTS" }),
    );
  });

  it.each([
    ["recorded", true, false, false],
    ["live", false, true, false],
    ["live", false, false, true],
    ["hybrid", true, false, false],
  ] as const)(
    "consumes %s at the defined first-use boundary",
    (delivery, validRecordedSegmentStarted, liveCutoffReached, checkedIn) => {
      expect(
        pointConsumptionTrigger({
          delivery,
          validRecordedSegmentStarted,
          liveCutoffReached,
          checkedIn,
        }),
      ).toBe(true);
    },
  );
});
