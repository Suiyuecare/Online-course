import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { organizationLifecycleItemSchema } from "@/application/organization-lifecycle";

const root = process.cwd();
const route = readFileSync(
  join(
    root,
    "src/app/api/staff/organizations/[organizationId]/status/route.ts",
  ),
  "utf8",
);
const panel = readFileSync(
  join(root, "src/components/organization-lifecycle-panel.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260730031000_organization_lifecycle_controls.sql",
  ),
  "utf8",
);

describe("organization lifecycle controls", () => {
  it("accepts only the safe staff projection", () => {
    expect(
      organizationLifecycleItemSchema.safeParse({
        organizationId: "99000000-0000-4000-8000-000000000001",
        legalName: "歲悅測試機構",
        status: "approved",
        invoiceEmail: "finance@example.test",
        contactName: "王小美",
        updatedAt: "2026-07-30T03:10:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      organizationLifecycleItemSchema.safeParse({
        organizationId: "99000000-0000-4000-8000-000000000001",
        legalName: "歲悅測試機構",
        status: "rejected",
        invoiceEmail: "finance@example.test",
        contactName: "王小美",
        updatedAt: "2026-07-30T03:10:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires a fresh target-bound step-up and a UUID idempotency key", () => {
    expect(route).toContain("requireIdempotencyKey(request)");
    expect(route).toContain('z.enum(["suspend", "reactivate"])');
    expect(route).toContain("p_nonce_hash");
    expect(route).toContain("createHash");
    expect(panel).toContain('"emergency_suspend"');
    expect(panel).toContain("input.organizationId");
    expect(panel).toContain("minLength={10}");
  });

  it("uses exact status transitions without deleting business evidence", () => {
    expect(migration).toContain("when 'suspend' then 'approved'");
    expect(migration).toContain("when 'suspend' then 'suspended'");
    expect(migration).toContain("ORGANIZATION_STATUS_TRANSITION_REJECTED");
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(?:orders|enrollments|point_ledger_events)/i,
    );
  });

  it("records an append-only audit event and notifies organization managers", () => {
    expect(migration).toContain("'organization.suspended'");
    expect(migration).toContain("'organization.reactivated'");
    expect(migration).toContain("perform internal.append_audit_event");
    expect(migration).toContain("insert into public.notifications");
    expect(migration).toContain("insert into public.notification_outbox");
    expect(migration).toContain("'owner', 'training_manager'");
  });

  it("does not leak database error details through the route", () => {
    expect(route).toContain(
      'throw new Error("ORGANIZATION_STATUS_CHANGE_REJECTED")',
    );
    expect(route).not.toContain("error?.message");
  });
});
