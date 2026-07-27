import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260724230000_close_clean_launch_product_blockers.sql",
);

describe("clean-database course and accreditation lifecycle", () => {
  it("allows authoring without accreditation but fails closed at review", () => {
    const route = source("src/app/api/staff/courses/drafts/route.ts");
    const editor = source("src/components/course-editor.tsx");

    expect(route).toContain(
      "accreditationRevisionId: z.uuid().nullable().optional()",
    );
    expect(route).toContain(
      'accreditationDisclosure: z.string().trim().max(2000).default("")',
    );
    expect(editor).toContain(
      'String(form.get("accreditationRevisionId") ?? "") || null',
    );
    expect(migration).toContain("if accreditation_revision is not null then");
    expect(migration).toContain(
      "ACCREDITATION_LINK_REQUIRED_BEFORE_SUBMISSION",
    );
    expect(migration).toContain("'accreditationLinkVerified', true");
  });

  it("uses typed, append-only, dual-control accreditation transitions", () => {
    const requestRoute = source(
      "src/app/api/staff/accreditation/revisions/[revisionId]/transitions/route.ts",
    );
    const decisionRoute = source(
      "src/app/api/staff/accreditation/transitions/[requestId]/decision/route.ts",
    );

    for (const status of ["approved", "rejected", "expired", "revoked"]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("accreditation_revision_append_only");
    expect(migration).toContain("DISTINCT_ACCREDITATION_REVIEWER_REQUIRED");
    expect(migration).toContain("ACCREDITATION_APPROVAL_SPEC_INVALID");
    expect(migration).toContain("submitted_approval_reference");
    expect(migration).toContain("submitted_points");
    expect(migration).toContain("submitted_retroactive_basis");
    expect(requestRoute).toContain("requireIdempotencyKey(request)");
    expect(requestRoute).toContain("approvalReference");
    expect(requestRoute).toContain("retroactiveBasis");
    expect(migration).toContain("'accreditation_result'");
    expect(decisionRoute).toContain('createHash("sha256")');
  });

  it("idempotently fulfills approvals and stops/refunds negative outcomes", () => {
    expect(migration).toContain(
      "create table public.accreditation_transition_effects",
    );
    expect(migration).toContain(
      "unique (accreditation_revision_id, effect_kind, subject_id)",
    );
    expect(migration).toContain("if not found then return false; end if;");
    expect(migration).toContain(
      "locked_reason = 'accreditation_not_yet_approved'",
    );
    expect(migration).toContain("status = 'paid_unfulfilled'");
    expect(migration).toContain("'accreditation_failure'");
    expect(migration).toContain("insert into public.refund_allocations");
    expect(migration).toContain(
      "from public.assignment_point_allocations allocation",
    );
    expect(migration).toContain("else 'compensated'");
    expect(migration).toContain("POINT_WALLET_DRIFT");
    expect(migration).toContain("current_status = 'revoked'");
    expect(migration).toContain("'accreditation.transition_effects_applied'");
  });
});

describe("typed launch settings and provider evidence", () => {
  it("keeps operating settings typed, masked, and under distinct review", () => {
    const settingRoute = source("src/app/api/staff/settings/route.ts");
    const decisionRoute = source(
      "src/app/api/staff/settings/[requestId]/decision/route.ts",
    );
    const panel = source("src/components/launch-control-panel.tsx");

    for (const key of [
      "legal_approved",
      "finance_configured",
      "incident_owner_configured",
      "bank_account",
      "finance_high_value_threshold",
    ]) {
      expect(migration).toContain(`'${key}'`);
      expect(panel).toContain(key);
    }
    expect(migration).toContain("BOOLEAN_SETTING_SPEC_INVALID");
    expect(migration).toContain("BANK_ACCOUNT_SETTING_SPEC_INVALID");
    expect(migration).toContain("FINANCE_THRESHOLD_SETTING_SPEC_INVALID");
    expect(migration).toContain("DISTINCT_OPERATING_SETTING_REVIEWER_REQUIRED");
    expect(migration).toContain("current_setting.value - 'accountNumber'");
    expect(settingRoute).toContain("requireIdempotencyKey(request)");
    expect(decisionRoute).toContain('createHash("sha256")');
    expect(panel).toContain("建立者不可覆核自己的申請");
  });

  it("only validates production providers after evidence and fresh health", () => {
    const requestRoute = source(
      "src/app/api/staff/providers/validations/route.ts",
    );
    const decisionRoute = source(
      "src/app/api/staff/providers/validations/[requestId]/decision/route.ts",
    );

    expect(migration).toContain(
      "create table public.provider_validation_requests",
    );
    expect(migration).toContain("test_environment = 'production'");
    expect(migration).toContain("provider_validation_dual_control");
    expect(migration).toContain(
      "DISTINCT_PROVIDER_VALIDATION_REVIEWER_REQUIRED",
    );
    expect(migration).toContain("health.status = 'healthy'");
    expect(migration).toContain("now() - interval '15 minutes'");
    expect(migration).toContain("PROVIDER_HEALTH_NOT_FRESH");
    expect(requestRoute).toContain("evidenceSha256");
    expect(requestRoute).toContain("requireIdempotencyKey(request)");
    expect(decisionRoute).toContain('createHash("sha256")');
  });

  it("makes every new control-plane table server-only", () => {
    for (const table of [
      "accreditation_transition_requests",
      "accreditation_transition_effects",
      "operating_setting_change_requests",
      "provider_validation_requests",
    ]) {
      expect(migration).toContain(`alter table public.${table}\n  enable row`);
      expect(migration).toContain(`alter table public.${table}\n  force row`);
      expect(migration).toContain(`revoke all on public.${table}`);
    }
  });
});

describe("operable accreditation submission workspace", () => {
  it("mounts only safe projections and guided lifecycle/batch controls", () => {
    const workspace = source("src/application/workspace.ts");
    const page = source("src/app/staff/[queue]/page.tsx");
    const panel = source("src/components/accreditation-operations-panel.tsx");

    expect(migration).toContain(
      "create or replace function public.read_launch_control_workspace",
    );
    expect(migration).toContain(
      "create or replace function public.read_accreditation_operations_workspace",
    );
    expect(migration).toContain("security invoker");
    expect(workspace).toContain("accreditationOperationsWorkspaceSchema");
    expect(workspace).toContain('"read_accreditation_operations_workspace"');
    expect(page).toContain("<AccreditationOperationsPanel");
    expect(panel).toContain('post("/api/staff/accreditation/batches"');
    expect(panel).toContain("/submitted");
    expect(panel).toContain("/results");
    expect(panel).toContain('"accreditation_result"');
    expect(panel).not.toMatch(
      /<input\b[^>]*\bname="(?:courseVersionId|accreditationRevisionId|batchId|enrollmentId)"/,
    );
  });
});
