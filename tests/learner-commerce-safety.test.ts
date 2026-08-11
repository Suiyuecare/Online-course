import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function cancellationMigration() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const file = readdirSync(directory).find((candidate) =>
    candidate.endsWith("_learner_pending_order_cancellation.sql"),
  );
  if (!file) throw new Error("learner cancellation migration missing");
  return readFileSync(join(directory, file), "utf8");
}

describe("learner commerce safety", () => {
  it("keeps payment-proof upload, scan, and submit independently retryable", () => {
    const component = source("src/components/payment-proof-form.tsx");

    expect(component).toContain("const [uploadBusy");
    expect(component).toContain("const [scanBusy");
    expect(component).toContain("const [submitBusy");
    expect(component).toContain("response.json().catch(() => null)");
    expect(component).toContain("fileRevision.current");
    expect(component).toContain(
      'selectedFile !== null && currentScanStatus !== "promoted"',
    );
    expect(component).toContain(
      'currentScanStatus === "promoted" ? uploadId : ""',
    );
    expect(component).toContain("清除附件");
    expect(component).toContain('role={scanMessage?.tone === "error"');
    expect(component).toContain("請按同一按鈕重試");
    expect(component).not.toContain("const result = await response.json();");
  });

  it("prevents duplicate refund submission and preserves retry context", () => {
    const component = source("src/components/refund-request-form.tsx");

    expect(component).toContain("if (busy || submitted) return");
    expect(component).toContain("disabled={busy || submitted}");
    expect(component).toContain("submissionIdentity");
    expect(component).toContain("response.json().catch(() => null)");
    expect(component).toContain("表單資料仍保留");
    expect(component).toContain('role={message?.tone === "error"');
    expect(component).not.toContain(".reset()");
  });

  it("cancels only an owned, unpaid pending-transfer order under a row lock", () => {
    const migration = cancellationMigration();

    expect(migration).toContain(
      "create or replace function internal.cancel_own_pending_transfer_order",
    );
    expect(migration).toContain("where orders.id = target_order");
    expect(migration).toContain("and orders.person_id = actor");
    expect(migration).toContain("for update");
    expect(migration).toContain("order_row.status <> 'pending_transfer'");
    expect(migration).toContain("order_row.amount_paid_twd <> 0");
    expect(migration).toContain("from public.payment_proofs proof");
    expect(migration).toContain(
      "from public.bank_transaction_allocations allocation",
    );
    expect(migration).toContain("set status = 'released'");
    expect(migration).toContain("set status = 'cancelled'");
    expect(migration).toContain("learner_cancel_idempotency_key = idempotency");
    expect(migration).toContain("insert into public.learner_cart_items");
    expect(migration).toContain("'order.cancelled_by_learner'");
  });

  it("exposes cancellation through a narrow authenticated RPC and API", () => {
    const migration = cancellationMigration();
    const route = source("src/app/api/orders/[orderId]/cancel/route.ts");
    const component = source("src/components/pending-order-cancellation.tsx");

    expect(migration).toContain(
      "create or replace function public.cancel_own_pending_transfer_order",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = pg_catalog, internal");
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("to authenticated");
    expect(route).toContain("mutation(request");
    expect(route).toContain("requireIdempotencyKey(request)");
    expect(route).toContain("confirmed: z.literal(true)");
    expect(component).toContain("請再次確認");
    expect(component).toContain("if (busy || completed) return");
    expect(component).toContain("idempotencyKey.current");
  });

  it("keeps every successful learner order continuation inside the portal", () => {
    const dashboard = source("src/app/learner/page.tsx");
    const checkout = source("src/components/contract-purchase-flow.tsx");

    expect(dashboard).toContain("href={`/learner/orders/${order.orderId}`}");
    expect(checkout).toContain(
      "window.location.assign(`/learner/orders/${result.data.orderId}`)",
    );
    expect(dashboard).not.toContain("href={`/orders/${order.orderId}`}");
    expect(checkout).not.toContain(
      "window.location.assign(`/orders/${result.data.orderId}`)",
    );
  });
});
