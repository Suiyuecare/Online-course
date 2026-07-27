import { DomainError } from "./feature-gates";

export type Allocation = {
  amountTwd: number;
  reversed: boolean;
};

export function assertTwd(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(
      "INVALID_MONEY",
      "TWD must be a non-negative integer",
    );
  }
}

export function activeAllocationTotal(allocations: Allocation[]): number {
  return allocations.reduce(
    (total, item) => total + (item.reversed ? -item.amountTwd : item.amountTwd),
    0,
  );
}

export function paymentMatch(input: {
  orderAmountTwd: number;
  transactionAmountTwd: number;
  transactionAllocations: Allocation[];
  orderAllocations: Allocation[];
}): "underpaid" | "matched" | "overpaid" {
  assertTwd(input.orderAmountTwd);
  assertTwd(input.transactionAmountTwd);
  const transactionUsed = activeAllocationTotal(input.transactionAllocations);
  const orderPaid = activeAllocationTotal(input.orderAllocations);
  if (transactionUsed > input.transactionAmountTwd) {
    throw new DomainError(
      "TRANSACTION_OVERALLOCATED",
      "allocation exceeds transaction",
    );
  }
  if (orderPaid < input.orderAmountTwd) return "underpaid";
  if (orderPaid > input.orderAmountTwd) return "overpaid";
  return "matched";
}

export function recordedRefundAmount(input: {
  allocationTwd: number;
  confirmedValidSeconds: number;
  requiredSeconds: number;
}): number {
  assertTwd(input.allocationTwd);
  if (input.requiredSeconds <= 0)
    throw new DomainError("INVALID_REQUIREMENT", "required seconds");
  const supplied = Math.min(
    1,
    Math.max(0, input.confirmedValidSeconds / input.requiredSeconds),
  );
  return Math.ceil(input.allocationTwd * (1 - supplied));
}

export function assertRefundCap(
  paidTwd: number,
  completedRefundsTwd: number,
  nextRefundTwd: number,
): void {
  [paidTwd, completedRefundsTwd, nextRefundTwd].forEach(assertTwd);
  if (completedRefundsTwd + nextRefundTwd > paidTwd) {
    throw new DomainError("REFUND_EXCEEDS_PAYMENT", "refund exceeds payment");
  }
}

export function b2cPaymentNeedsSecondReview(input: {
  amountTwd: number;
  relatedParty: boolean;
  thresholdTwd: number | null;
}): boolean {
  if (input.thresholdTwd === null) {
    throw new DomainError(
      "FINANCE_THRESHOLD_MISSING",
      "B2C commerce must remain closed",
    );
  }
  return input.relatedParty || input.amountTwd >= input.thresholdTwd;
}
