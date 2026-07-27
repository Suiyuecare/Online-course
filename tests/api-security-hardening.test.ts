import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("API security hardening regressions", () => {
  it("resolves service-backed sensitive operations through the JWT session fence", () => {
    const identity = source(
      "src/infrastructure/security/accreditation-identity.ts",
    );
    expect(identity).toContain('supabase.rpc("require_current_person")');
    expect(identity).not.toContain('.from("auth_identities")');

    const migration = source(
      "supabase/migrations/20260724220000_api_security_hardening.sql",
    );
    expect(migration).toContain(
      "create or replace function internal.require_current_person()",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "grant execute on function public.require_current_person()",
    );
    const bootstrap = source(
      "supabase/migrations/20260724011637_rls_grants_bootstrap.sql",
    );
    expect(bootstrap).toContain(
      "grant usage on schema internal to authenticated, service_role;",
    );
  });

  it("matches the accreditation reconfirm RPC response contract", () => {
    const route = source(
      "src/app/api/profile/accreditation/reconfirm/route.ts",
    );
    expect(route).toContain('status: z.literal("verified")');
    expect(route).not.toContain('status: z.literal("reconfirmed")');
  });

  it("authorizes refund encryption before invoking KMS", () => {
    const personal = source("src/app/api/orders/[orderId]/refunds/route.ts");
    expect(
      personal.indexOf('supabase.rpc(\n      "read_own_order"'),
    ).toBeLessThan(personal.indexOf("encryptSensitivePayload("));

    const points = source(
      "src/app/api/organizations/[organizationId]/point-refunds/route.ts",
    );
    expect(points.indexOf('"authorize_point_refund_preparation"')).toBeLessThan(
      points.indexOf("encryptSensitivePayload("),
    );
  });

  it("authorizes organization invitations before wrapping invitation data", () => {
    const invitation = source(
      "src/app/api/organizations/[organizationId]/invitations/route.ts",
    );
    expect(
      invitation.indexOf('"authorize_organization_invitation_preparation"'),
    ).toBeLessThan(invitation.indexOf("prepareOrganizationInvitation({"));

    const roster = source(
      "src/app/api/organizations/[organizationId]/invitations/import/route.ts",
    );
    expect(
      roster.indexOf('"authorize_organization_invitation_preparation"'),
    ).toBeLessThan(roster.indexOf("prepareOrganizationInvitation({"));
  });

  it("reports unavailable dependencies with a non-success health status", () => {
    const health = source("src/app/api/health/route.ts");
    expect(health).toContain("evaluateRuntimeHealth");
    expect(health).toContain('health.status === "ready" ? 200 : 503');
    expect(health).toContain('"provider_health"');
    expect(health).toContain('"worker_heartbeats"');
  });

  it("bounds JSON and webhook request bodies before parsing", () => {
    const helpers = source("src/app/api/_shared/route-helpers.ts");
    expect(helpers).toContain("readRequestTextWithLimit");
    expect(helpers).not.toContain("await request.json()");

    for (const routePath of [
      "src/app/api/webhooks/resend/route.ts",
      "src/app/api/webhooks/stream/route.ts",
      "src/app/api/webhooks/zoom/route.ts",
    ]) {
      const route = source(routePath);
      expect(route).toContain("webhookRequestBodyLimitBytes");
      expect(route).toContain("readRequestTextWithLimit");
      expect(route).not.toContain("await request.text()");
    }
  });

  it("persists an encrypted Zoom creation receipt before finalization", () => {
    const route = source("src/app/api/staff/live/sessions/route.ts");
    const migration = source(
      "supabase/migrations/20260724220000_api_security_hardening.sql",
    );
    expect(route).toContain('"claim_zoom_meeting_provider_request"');
    expect(route).toContain('operation: "create_meeting"');
    expect(route).toContain("recordProviderOperationReceipt");
    expect(route).toContain("encryptedPasscode");
    expect(route).toContain("verifyMeetingSafety");
    expect(route).toContain("resolveHostIdentity");
    expect(route).toContain("p_provider_host_id");
    expect(route).toContain("p_accountless_join_enabled");
    expect(route).toContain(
      "competingReceipt.providerReference === createdMeetingNumber",
    );
    expect(route).toContain('"confirmed_absent"');
    expect(route).toContain('receiptWriteOutcome === "unknown"');
    expect(route).toContain(
      'receiptWriteOutcome === "not_attempted" ||\n        receiptWriteOutcome === "competing"',
    );
    expect(route).toContain('"enqueue_zoom_orphan_cleanup"');
    expect(route).toContain('"finalize_verified_live_session_setup"');
    expect(route.indexOf("recordProviderOperationReceipt")).toBeLessThan(
      route.indexOf('"finalize_verified_live_session_setup"'),
    );
    expect(migration).toContain(
      "create or replace function internal.claim_zoom_meeting_provider_request",
    );
    expect(migration).toContain(
      "create or replace function internal.finalize_verified_live_session_setup",
    );
    expect(migration).toContain("alter column waiting_room set default false");
    expect(migration).toContain("provider_host_id_snapshot");
    expect(migration).toContain(
      "receipt.response_payload ->> 'meetingType' = '2'",
    );
    expect(migration).toContain(
      "receipt.response_payload ->> 'topic' = live_session.title",
    );
    expect(migration).toContain(
      "receipt.response_payload\n      #>> '{safety,accountlessJoinEnabled}' = 'true'",
    );
    expect(migration).toContain(
      "receipt.response_payload #>> '{safety,waitingRoom}' = 'true'",
    );
    expect(migration).toContain(
      "revoke execute on function public.finalize_live_session_setup",
    );
    expect(migration).toContain("provider_receipt_enqueue_zoom_setup_finalize");
    expect(migration).toContain(
      "before insert on public.provider_operation_receipts",
    );
    expect(migration).toContain("for update of live_session, reservation");
    expect(migration).toContain("live.zoom_setup_late_receipt_restored");
    expect(migration).toContain("ZOOM_SETUP_RECEIPT_SAFETY_STALE");
    expect(migration).toContain(
      "epoch from (new.created_at - safety_verified_at)",
    );
    expect(migration).toContain(
      "create or replace function internal.enqueue_zoom_orphan_cleanup",
    );
    expect(migration).toContain(
      "create or replace function internal.complete_zoom_orphan_cleanup",
    );
    expect(migration).toContain("'zoom_setup_finalize'");
    const worker = source("src/app/api/workers/wake/route.ts");
    expect(worker).toContain('job.job_type === "zoom_setup_finalize"');
    expect(worker).toContain('job.job_type === "zoom_orphan_cleanup"');
    expect(worker).toContain('"complete_zoom_orphan_cleanup"');
  });

  it("provides an operable dual-control Zoom crash-gap worklist", () => {
    const page = source("src/app/staff/[queue]/page.tsx");
    const panel = source("src/components/zoom-setup-reconciliation-panel.tsx");
    const migration = source(
      "supabase/migrations/20260724220000_api_security_hardening.sql",
    );
    expect(page).toContain("readZoomSetupReconciliationWorklist");
    expect(panel).toContain("zoom_setup_reconcile_propose");
    expect(panel).toContain("zoom_setup_reconcile_decide");
    expect(migration).toContain(
      "internal.read_zoom_setup_reconciliation_worklist",
    );
    expect(migration).toContain("latest_request.proposed_by <> actor");
    expect(migration).toContain("'jobStatus', latest_job.status");
    expect(migration).toContain("provider_verification_failed");
    expect(migration).toContain("clock_timestamp() - interval '15 minutes'");
    expect(migration).toContain("internal.read_zoom_orphan_cleanup_worklist");
    expect(panel).toContain("ZoomOrphanCleanupPanel");
  });

  it("does not revoke a Zoom registrant while its receipt outcome is unknown", () => {
    const route = source("src/app/api/live/[liveSessionId]/join/route.ts");
    const reconciliation = source(
      "src/application/zoom-provider-reconciliation.ts",
    );
    const migration = source(
      "supabase/migrations/20260724220000_api_security_hardening.sql",
    );
    const stage = route.indexOf("await stageRegistrantReconciliation");
    const receiptWrite = route.indexOf("await recordProviderOperationReceipt");
    const receiptFailure = route.indexOf("catch (receiptError)");
    expect(stage).toBeGreaterThan(0);
    expect(stage).toBeLessThan(receiptWrite);
    expect(receiptFailure).toBeGreaterThan(receiptWrite);
    expect(route.indexOf("await zoom.revokeRegistrant", receiptFailure)).toBe(
      -1,
    );
    expect(reconciliation).toContain(
      'outcome: "reconciliation_required", reason: "receipt_absent"',
    );
    expect(migration).toContain("private.zoom_registrant_receipt_fences");
    expect(migration).toContain("ZOOM_REGISTRANT_RECEIPT_FENCED_REVOKE");
    expect(migration).toContain(
      "internal.complete_zoom_registrant_reconciliation",
    );
  });
});
