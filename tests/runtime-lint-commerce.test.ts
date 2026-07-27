import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724238000_runtime_lint_commerce.sql",
  ),
  "utf8",
);

function functionBlock(name: string) {
  const start = migration.indexOf(
    `create or replace function internal.${name}(`,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf(
    "\ncreate or replace function internal.",
    start + 1,
  );
  return migration.slice(start, next === -1 ? undefined : next);
}

describe("commerce runtime lint hardening", () => {
  it("replaces exactly the seven affected internal functions", () => {
    expect(
      migration.match(/create or replace function internal\.[a-z0-9_]+\(/g),
    ).toHaveLength(7);
    for (const name of [
      "create_b2c_order",
      "finalize_order_payment",
      "build_refundable_scopes",
      "request_refund",
      "import_bank_statement_batch",
      "request_live_session_change",
      "change_b2c_live_session",
    ]) {
      const block = functionBlock(name);
      expect(block).toMatch(/security definer/i);
      expect(block).toContain("set search_path = pg_catalog, public");
      expect(block).toContain(`revoke all on function internal.${name}(`);
    }
  });

  it("uses a supported empty JSON object predicate", () => {
    const block = functionBlock("create_b2c_order");
    expect(block).not.toContain("jsonb_object_length");
    expect(block).toContain("coalesce(live_selections = '{}'::jsonb, true)");
    expect(block).toContain("extensions.gen_random_bytes(24)");
  });

  it("removes PL/pgSQL variable and column ambiguities", () => {
    const payment = functionBlock("finalize_order_payment");
    expect(payment).toContain("new_entitlement_id uuid;");
    expect(payment).not.toContain("\n  entitlement_id uuid;");
    expect(payment).toContain("returning id into new_entitlement_id;");

    const refundable = functionBlock("build_refundable_scopes");
    expect(refundable).toContain("target_enrollment_id uuid;");
    expect(refundable).not.toContain("\n  enrollment_id uuid;");
    expect(refundable).toContain(
      "certificate.enrollment_id = target_enrollment_id",
    );

    const refund = functionBlock("request_refund");
    expect(refund).toContain("requested_scope_id uuid;");
    expect(refund).not.toContain("\n  scope_id uuid;");
    expect(refund).toContain("allocation.scope_id = requested_scope_id");

    const bankImport = functionBlock("import_bank_statement_batch");
    expect(bankImport).toContain("imported_batch_id uuid;");
    expect(bankImport).not.toContain("\n  batch_id uuid;");
    expect(bankImport).toContain(
      "transaction_row.batch_id = imported_batch_id",
    );

    const liveChange = functionBlock("request_live_session_change");
    expect(liveChange).toContain("job_business_key text :=");
    expect(liveChange).not.toContain("\n  business_key text :=");
    expect(liveChange).toContain("job.business_key = job_business_key");

    const b2cChange = functionBlock("change_b2c_live_session");
    expect(b2cChange).toContain("new_entitlement_id uuid;");
    expect(b2cChange).not.toContain("\n  entitlement_id uuid;");
    expect(b2cChange).toContain("returning id into new_entitlement_id;");
  });

  it("retains the intentionally narrow authenticated grant", () => {
    const block = functionBlock("change_b2c_live_session");
    expect(block).toContain(
      "from public, anon, authenticated;\ngrant execute on function",
    );
    expect(block).toContain(") to authenticated;");
    expect(migration).not.toContain("#variable_conflict");
  });
});
