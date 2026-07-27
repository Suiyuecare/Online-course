# Manual bank, invoice, refund, and point SOP

## Daily bank import

1. Finance uploads the bank source file to quarantine.
2. File worker validates size, MIME/magic bytes, archive expansion, malware, and
   content hash before promotion.
3. Import creates an immutable batch and immutable bank transactions using
   source hash and canonical bank fingerprint.
4. Allocate transactions to B2C orders or organization top-ups. Never edit a
   transaction; correction is a reversal allocation.
5. The database locks transaction and order/wallet, prevents over-allocation,
   and opens access only at exact amount.
6. A different finance/platform administrator reconciles the daily source hash
   and bank total.

Underpayment, overpayment, split, combined, late, unmatched, capacity loss, and
input errors create a reconciliation case. Proof submission is not payment.

## Dual control

- Organization top-ups always require two different reviewers before mint.
- Related-party and policy-threshold B2C payments require two different
  reviewers before entitlement.
- Missing high-value threshold closes B2C commerce.
- Submitter cannot review the same allocation.

## Invoice/receipt

Payment creates an `invoice_records` pending task. Finance uses the approved
external invoice/receipt system and appends issue/failure/allowance/void events.
Invoice failure alerts but does not revoke a valid paid entitlement. Accounting
must approve tax type, issue timing, buyer tax ID, and allowance method.

## Refund

1. Accepting a case atomically freezes only the affected component scope and
   snapshots valid use.
2. Rejection appends an explicit restore event. Approval keeps it frozen.
3. Recorded proportional refund uses confirmed valid minutes and rounds up for
   the consumer. Provider/accreditation/Suiyue failures use full-refund rules.
4. Each partial refund has its own allocation, disbursement attempt, and invoice
   allowance/void event. Cumulative completed refunds cannot exceed payment.
5. Completion, booking, Stream/Zoom access, and uncredited certificate are
   recalculated only for the refunded scope. Whole-order termination alone
   revokes the entire entitlement.
6. Complete transfer within 15 days after correct destination data is received.

## Organization points

- NT$1 paid creates one integer point; no bonus, tier, transfer, cash-out, or
  expiry.
- Assignment locks the wallet and reserves oldest lots first.
- Recorded consumes at the first server-validated candidate segment.
- Live consumes at 24-hour cutoff or formal check-in, whichever occurs first.
- Hybrid consumes at the earliest recorded/live trigger.
- Before consumption a training manager can release; after consumption no
  ordinary reassignment/refund. Suiyue/legal compensation is an append event.
- Owner/finance may request return of only the available portion of the
  original paid lot. Request atomically moves those points from available to
  refund-reserved, encrypts the bank destination with a case-specific envelope,
  and requires two distinct finance approvals who are not the requester.
- Account access is a separate fresh-TOTP action and one-time two-minute server
  capability. Successful bank return moves the same lot from refund-reserved to
  refunded, appends payment/point/invoice events, and never permits a negative
  wallet. Failed return retains the reservation for an idempotent retry.
- Organization training Excel is generated server-side from organization-funded
  assignments only. It includes native dates/percentages and formula
  neutralization, but excludes identity numbers, answer rows, survey text, and
  raw attendance/playback events.
