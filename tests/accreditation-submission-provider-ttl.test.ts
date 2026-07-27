import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260724236000_accreditation_submission_and_provider_ttl.sql",
);

describe("accreditation submission scope and claims", () => {
  it("binds each batch to the delivery-specific immutable scope", () => {
    expect(migration).toContain(
      "internal.accreditation_submission_scope_is_valid",
    );
    expect(migration).toContain("version.delivery_type = 'recorded'");
    expect(migration).toContain("target_live_session is null");
    expect(migration).toContain("version.delivery_type in ('live', 'hybrid')");
    expect(migration).toContain("session.status = 'ended'");
    expect(migration).toContain("latest.id = target_accreditation_revision");
    expect(migration).toContain("latest.status = 'approved'");
    expect(migration).toContain("latest.valid_until > observed_at");
  });

  it("prevents duplicate active or accepted submission claims", () => {
    expect(migration).toContain(
      "create table public.accreditation_submission_claims",
    );
    expect(migration).toContain(
      "create unique index one_active_or_accepted_submission_per_enrollment",
    );
    expect(migration).toContain("where status in ('active', 'accepted')");
    expect(migration).toContain("eligibility_snapshot_id uuid not null");
    expect(migration).toContain(
      "accreditation_submission_claim_events_append_only",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
  });

  it("immutably binds live rows to exact qualified attendance evidence", () => {
    expect(migration).toContain("required_live_booking_ids uuid[] not null");
    expect(migration).toContain(
      "internal.capture_eligibility_required_live_bookings",
    );
    expect(migration).toContain(
      "internal.accreditation_submission_item_scope_is_valid",
    );
    expect(migration).toContain("live_booking_id uuid references");
    expect(migration).toContain("booking.status = 'attended'");
    expect(migration).toContain("attendance.qualified");
    expect(migration).toContain("attendance.quarantined_at is null");
    expect(migration).toContain("component.component_type = 'live'");
    expect(migration).toContain("component.required");
    expect(migration).toContain("ACCREDITATION_LIVE_BINDING_IMMUTABLE");
    expect(migration).toContain("target_booking.id is not null");

    const lockStart = migration.indexOf(
      "create or replace function\n  internal.lock_and_validate_accreditation_submission_items",
    );
    const lockEnd = migration.indexOf(
      "create or replace function internal.batch_has_valid_active_claims",
      lockStart,
    );
    const lockBlock = migration.slice(lockStart, lockEnd);
    let priorLock = -1;
    for (const lockStep of [
      "perform enrollment.id",
      "perform certificate.id",
      "perform session.id",
      "perform booking.id",
      "perform attendance.id",
      "perform claim.id",
    ]) {
      const nextLock = lockBlock.indexOf(lockStep);
      expect(nextLock).toBeGreaterThan(priorLock);
      priorLock = nextLock;
    }
  });

  it("allows only explicit needs-correction lineage resubmission", () => {
    const route = source("src/app/api/staff/accreditation/batches/route.ts");
    const workspace = source("src/application/workspace.ts");
    const panel = source("src/components/accreditation-operations-panel.tsx");

    expect(migration).toContain("supersedes_batch_id uuid");
    expect(migration).toContain("one_correction_batch_per_source");
    expect(migration).toContain("prior_batch.status <> 'needs_correction'");
    expect(migration).toContain("ACCREDITATION_CORRECTION_LINEAGE_INVALID");
    expect(migration).toContain(
      "'suiyue:accreditation-batch-idempotency:' || idempotency::text",
    );
    expect(migration).toContain("claim.status = 'superseded'");
    expect(route).toContain(
      "supersedesBatchId: z.uuid().nullable().optional()",
    );
    expect(route).toContain(
      "p_supersedes_batch_id: input.supersedesBatchId ?? null",
    );
    expect(workspace).toContain("supersedesBatchId");
    expect(panel).toContain("selectedCorrectionBatchId");
    expect(panel).toContain("補正送審批次已建立");
  });
});

describe("negative revision isolation and lifecycle gates", () => {
  it("isolates all unfinished batches under the course lock", () => {
    expect(migration).toContain(
      "internal.isolate_batches_for_negative_accreditation",
    );
    expect(migration).toContain("'draft', 'approved', 'exported', 'submitted'");
    expect(migration).toContain("'needs_correction'");
    expect(migration).toContain(
      "'suiyue:accreditation:' || new.course_id::text",
    );
    expect(migration).toContain("status = 'isolated'");
    expect(migration).toContain("isolated_by_revision_id = new.id");
  });

  it("revalidates scope and active claims at every downstream gate", () => {
    expect(migration).toContain("internal.lock_accreditation_submission_batch");
    for (const functionName of [
      "create_accreditation_submission_batch",
      "approve_and_authorize_export",
      "record_accreditation_export",
      "mark_accreditation_batch_submitted",
      "record_accreditation_batch_results",
    ]) {
      const start = migration.indexOf(
        `create or replace function internal.${functionName}`,
      );
      expect(start).toBeGreaterThan(-1);
      const next = migration.indexOf("create or replace function ", start + 40);
      const block = migration.slice(start, next === -1 ? undefined : next);
      if (functionName !== "create_accreditation_submission_batch") {
        expect(block).toContain("internal.lock_accreditation_submission_batch");
      }
      expect(block).toContain(
        "internal.lock_and_validate_accreditation_submission_items",
      );
    }
  });

  it("cannot accept or notify a revoked enrollment or certificate", () => {
    expect(migration).toContain("enrollment.status = 'submitted'");
    expect(migration).toContain("certificate.current_status = 'revoked'");
    expect(migration).toContain("enrollment.status = 'credited'");
    expect(migration).toContain("certificate.current_status = 'credited'");
    expect(migration).toContain(
      "or certificate.current_status in ('credited', 'revoked')",
    );
  });
});

describe("provider evidence TTL", () => {
  it("uses an explicit 90-day evidence expiry in approval and health", () => {
    const runtime = source("src/domain/runtime-health.ts");
    const healthRoute = source("src/app/api/health/route.ts");
    const panel = source("src/components/launch-control-panel.tsx");

    expect(migration).toContain("production_validation_expires_at timestamptz");
    expect(migration).toContain("request.tested_at + interval '90 days'");
    expect(migration).toContain("PROVIDER_EVIDENCE_EXPIRED_OR_UNHEALTHY");
    expect(migration).toContain(
      "internal.provider_production_validation_is_current",
    );
    expect(runtime).toContain("productionValidationExpiresAt");
    expect(runtime).toContain("isUnexpired");
    expect(healthRoute).toContain("production_validation_expires_at");
    expect(panel).toContain("evidenceExpiresAt");
    expect(panel).toContain("request.canApprove");
  });

  it("fails closed in publication, purchase readiness, and preview", () => {
    expect(migration).toContain(
      "course_publication_requires_current_provider_validation",
    );
    expect(migration).toContain(
      "create or replace function internal.read_public_course_readiness",
    );
    expect(migration).toContain(
      "create or replace function internal.authorize_public_course_preview",
    );
    expect(migration).toContain("STREAM_PROVIDER_VALIDATION_EXPIRED");
    expect(migration).toContain("LIVE_PROVIDER_VALIDATION_EXPIRED");
    expect(migration).toContain("'provider_unavailable'");
  });

  it("ships a rollback-safe pgTAP transaction fixture", () => {
    const fixture = source(
      "supabase/tests/accreditation_submission_provider_ttl.test.sql",
    );
    expect(fixture.trimStart()).toMatch(/^begin;/);
    expect(fixture).toContain("select extensions.plan(19)");
    expect(fixture).toContain(
      "one enrollment cannot be active or accepted in two batches",
    );
    expect(fixture).toContain(
      "a negative latest revision isolates every unfinished batch",
    );
    expect(fixture).toContain(
      "production provider validation fails closed after its explicit TTL",
    );
    expect(fixture).toContain(
      "an A-qualified learner with a cancelled B booking cannot enter B",
    );
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
  });
});
