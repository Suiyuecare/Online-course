import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const migration = source(
  "supabase/migrations/20260730060000_fix_b2b_proof_and_role_isolation.sql",
);

describe("organization top-up proof evidence", () => {
  it("promotes the same safe upload contract as a personal order proof", () => {
    const route = source(
      "src/app/api/organizations/topups/[topupId]/proof/route.ts",
    );
    const application = source("src/application/platform.ts");
    const method = application.slice(
      application.indexOf("submitPointTopupProof"),
      application.indexOf(
        "createOrder(",
        application.indexOf("submitPointTopupProof"),
      ),
    );

    expect(route).toContain("quarantineId: z.uuid().nullable().optional()");
    expect(route).toContain('"read_safe_quarantine_upload"');
    expect(route).toContain("resolveActivePerson(supabase)");
    expect(route).toContain('p_purpose: "payment_proof"');
    expect(route).toContain("objectPath = safe.data.objectPath");
    expect(route).toContain("contentHash = safe.data.contentSha256");
    expect(method).toContain("p_object_path: input.objectPath");
    expect(method).toContain("p_content_hash: input.contentHash");
  });

  it("rejects forged upload references and binds idempotency to all evidence", () => {
    for (const invariant of [
      "upload.owner_person_id = actor",
      "upload.purpose = 'payment_proof'",
      "upload.status = 'promoted'",
      "upload.promoted_object_path = object_path",
      "upload.promoted_sha256 = content_hash",
      "prior_proof.promoted_object_path is distinct from object_path",
      "prior_proof.content_sha256 is distinct from content_hash",
      "IDEMPOTENCY_KEY_REUSED",
      "SAFE_UPLOAD_REQUIRED",
      "'hasObject', object_path is not null",
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).toContain(
      "drop function public.submit_point_topup_proof(",
    );
    expect(migration).toContain(
      "case when object_path is null then 'not_provided' else 'safe' end",
    );
  });
});

describe("organization role-specific projections", () => {
  it("removes legacy projection entry points and exposes only safe v3 RPCs", () => {
    for (const legacy of [
      "public.read_organization_workspace_details(uuid)",
      "public.read_organization_workspace_v2(uuid)",
      "public.read_organization_training_report_v2(",
    ]) {
      expect(migration).toContain(`revoke all on function ${legacy}`);
    }
    expect(migration).toContain("internal.require_organization_capability(");
    expect(migration).toContain("target_organization, 'training_read'");
    expect(migration).toContain(
      "jsonb_set(result, '{pointLedger}', '[]'::jsonb, true)",
    );
    expect(migration).toContain(
      "grant execute on function public.read_organization_training_report_v3(",
    );
  });

  it("keeps training and finance UI surfaces mutually exclusive", () => {
    const records = source("src/components/organization-records.tsx");
    const actions = source("src/components/organization-actions.tsx");
    const reportRoute = source(
      "src/app/api/organizations/[organizationId]/reports/training/route.ts",
    );
    const workspace = source("src/application/workspace.ts");
    const exportHeading = actions.indexOf("匯出機構培訓報表");
    const exportGuard = actions.slice(exportHeading - 500, exportHeading);

    expect(records).toContain("details.capabilities.canViewTraining");
    expect(records).toContain("details.capabilities.canViewFinance");
    expect(exportGuard).toContain(
      "details?.capabilities.canExportTrainingReport",
    );
    expect(reportRoute).toContain('"read_organization_training_report_v3"');
    for (const capability of [
      "canViewFinance",
      "canViewTraining",
      "canExportTrainingReport",
    ]) {
      expect(workspace).toContain(capability);
    }
  });
});
