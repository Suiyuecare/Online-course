import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260730061000_operations_control_plane_v1.sql",
);

describe("operations control plane v1", () => {
  it("keeps incident, decision, evidence, and acknowledgement ledgers append-only", () => {
    for (const table of [
      "security_incident_transition_requests",
      "security_incident_transition_decisions",
      "security_incident_events",
      "operations_dead_letter_actions",
      "operations_evidence_events",
    ]) {
      expect(migration).toContain(`public.${table}`);
      expect(migration).toMatch(
        new RegExp(`${table}[\\s\\S]*?prevent_append_only_change`),
      );
    }
  });

  it("requires independent incident review and target-bound fresh step-up", () => {
    expect(migration).toContain("request_row.requested_by = actor");
    expect(migration).toContain("INDEPENDENT_INCIDENT_REVIEW_REQUIRED");
    expect(migration).toContain(
      "'incident_transition',\n    target_incident::text || ':' || submitted_action",
    );
    expect(migration).toContain(
      "'incident_transition',\n    target_request::text || ':' || submitted_decision",
    );
    expect(migration).toContain("INCIDENT_TRANSITION_STALE");
  });

  it("never blindly replays provider or notification side effects", () => {
    expect(migration).toContain("DEAD_LETTER_RECONCILIATION_REQUIRED");
    expect(migration).toContain("'completion_evaluate'");
    expect(migration).toContain("'recorded_progress_recompute'");
    expect(migration).toContain("'live_attendance_settle'");
    const retryBlock = migration.slice(
      migration.indexOf(
        "create or replace function internal.act_on_operations_dead_letter",
      ),
      migration.indexOf(
        "create or replace function public.act_on_operations_dead_letter",
      ),
    );
    expect(retryBlock).not.toContain("'provider_event_process'");
    expect(retryBlock).not.toContain("'zoom_setup_finalize'");
    expect(retryBlock).toContain("set status = 'retry'");
    expect(retryBlock).toContain("providerReplayAttempted");
  });

  it("projects no queue payload, destination ciphertext, or raw error text", () => {
    const projection = migration.slice(
      migration.indexOf(
        "create or replace function internal.read_operations_control_plane",
      ),
    );
    expect(projection).not.toContain("destination_ciphertext");
    expect(projection).not.toContain("template_data");
    expect(projection).not.toContain("job.payload");
    expect(projection).not.toContain("'lastError'");
    expect(projection).toContain("'failureClass'");
  });

  it("records evidence without claiming to execute an external operation", () => {
    expect(migration).toContain("'externalActionPerformed', false");
    expect(migration).toContain("database_restore_verified");
    expect(migration).toContain("storage_restore_verified");
    const panel = source("src/components/operations-control-panel.tsx");
    expect(panel).toContain("未呼叫任何外部備份或還原服務");
  });

  it("uses same-origin, rate-limit, idempotency and step-up API boundaries", () => {
    for (const route of [
      "src/app/api/staff/operations/incidents/[incidentId]/route.ts",
      "src/app/api/staff/operations/dead-letters/[sourceKind]/[sourceId]/route.ts",
      "src/app/api/staff/operations/evidence/route.ts",
    ]) {
      const routeSource = source(route);
      expect(routeSource).toContain("mutation(request");
      expect(routeSource).toContain("requireIdempotencyKey(request)");
      expect(routeSource).toContain('createHash("sha256")');
    }
  });
});
