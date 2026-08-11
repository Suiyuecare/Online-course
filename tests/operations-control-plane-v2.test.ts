import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260730065000_operations_control_plane_v2.sql",
);

describe("operations control plane v2", () => {
  it("serves only effective legal metadata and never silently substitutes prose", () => {
    const page = source("src/app/legal/page.tsx");
    const route = source("src/app/api/legal/documents/[documentId]/route.ts");
    expect(migration).toContain("internal.read_effective_legal_center");
    expect(migration).toContain("document.approved_by_legal");
    expect(migration).toContain("document.effective_at <= now()");
    expect(migration).toContain("'contentSha256'");
    expect(migration).toContain("'downloadPath'");
    const legalProjection = migration.slice(
      migration.indexOf(
        "create or replace function internal.read_effective_legal_center",
      ),
      migration.indexOf(
        "create or replace function internal.read_staff_audit_events",
      ),
    );
    expect(legalProjection).not.toContain("'objectPath'");
    expect(legalProjection).not.toContain("'specification'");
    expect(page).toContain("readEffectiveLegalCenter(await userSupabase())");
    expect(page).toContain("不會用頁面內建文字代替資料庫已發布版本");
    expect(route).toContain("await readEffectiveLegalCenter(supabase)");
    expect(route).toContain(
      "document.content_sha256 !== effectiveDocument.contentSha256",
    );
    expect(migration).toContain(
      "alter function public.read_effective_legal_center()",
    );
    expect(migration).toContain("owner to suiyue_catalog_owner");
    expect(migration).not.toContain("grant usage on schema internal to anon");
    expect(route).toContain('"x-legal-document-sha256"');
    expect(route).toContain('etag: `"${document.content_sha256}"`');
  });

  it("keeps the audit explorer role-scoped and excludes sensitive payloads", () => {
    const projection = migration.slice(
      migration.indexOf(
        "create or replace function internal.read_staff_audit_events",
      ),
      migration.indexOf(
        "create or replace function internal.read_staff_sla_workspace",
      ),
    );
    expect(projection).toContain("internal.has_staff_role('platform_admin')");
    expect(projection).toContain("event.sequence < cursor_before");
    expect(projection).toContain("limit effective_limit + 1");
    expect(projection).toContain("'targetReference'");
    expect(projection).toContain("'identified_actor'");
    expect(projection).toContain(
      "left(lower(event.action), length(normalized_action))",
    );
    expect(projection).not.toContain(
      "event.action like normalized_action || '%'",
    );
    for (const forbidden of [
      "'eventData'",
      "'reason'",
      "'sourceIp'",
      "'requestId'",
      "'targetId'",
    ]) {
      expect(projection).not.toContain(forbidden);
    }
    const panel = source("src/components/audit-explorer-panel.tsx");
    expect(panel).toContain("不回傳事件 payload、理由、來源");
  });

  it("records SLA escalation evidence through the durable worker without external sends", () => {
    const worker = source("src/app/api/workers/wake/route.ts");
    expect(migration).toContain("internal.enqueue_due_sla_escalations");
    expect(migration).toContain("'sla_escalation_record'");
    expect(migration).toContain("internal.record_sla_escalation");
    expect(migration).toContain("'externalNotificationSent', false");
    expect(migration).toContain("else interval '24 hours'");
    expect(migration).toContain("'nextCursor', next_cursor");
    expect(migration).toContain("limit effective_limit + 1");
    expect(migration).toContain(
      "(deadline_at, reference) > (cursor_deadline, cursor_reference)",
    );
    expect(worker).toContain('"enqueue_due_sla_escalations"');
    expect(worker).toContain('job.job_type === "sla_escalation_record"');
    expect(worker).toContain('"record_sla_escalation"');
    const slaBlock = migration.slice(
      migration.indexOf(
        "create or replace function internal.enqueue_due_sla_escalations",
      ),
      migration.indexOf(
        "create or replace function internal.retention_candidate_summary",
      ),
    );
    expect(slaBlock).not.toContain("notification_outbox");
    expect(slaBlock).not.toContain("resend");
    expect(slaBlock).not.toContain("twilio");
  });

  it("limits retention controls to dry-run evidence with independent review", () => {
    expect(migration).toContain("retention_dry_run_requests_append_only");
    expect(migration).toContain("retention_dry_run_decisions_append_only");
    expect(migration).toContain("INDEPENDENT_RETENTION_REVIEW_REQUIRED");
    expect(migration).toContain("RETENTION_DRY_RUN_PENDING_REVIEW");
    expect(migration).toContain("RETENTION_EVIDENCE_RECORD_REQUIRED");
    expect(migration).toContain("retention_candidate_manifest_verified");
    expect(migration).toContain("operations_evidence_event_id");
    expect(migration).toContain("'physicalPurgePerformed', false");
    expect(migration).toContain("submitted_action not in (");
    expect(migration).toContain("'retention_dry_run'");
    const retentionBlock = migration.slice(
      migration.indexOf(
        "create or replace function internal.retention_candidate_summary",
      ),
    );
    expect(retentionBlock).not.toMatch(/\bdelete\s+from\b/i);
    expect(retentionBlock).not.toMatch(/\btruncate\b/i);
    expect(retentionBlock).not.toMatch(/\bexecute\s+format\b/i);
    expect(retentionBlock).toContain("candidateManifestSha256");
    expect(retentionBlock).toContain("string_agg(");
    expect(retentionBlock).not.toContain("candidateChecksum");
    expect(retentionBlock).not.toContain("newer.revision = candidate.revision");
    for (const route of [
      "src/app/api/staff/operations/retention/[policyId]/route.ts",
      "src/app/api/staff/operations/retention/requests/[requestId]/evidence/route.ts",
      "src/app/api/staff/operations/retention/requests/[requestId]/decision/route.ts",
    ]) {
      const routeSource = source(route);
      expect(routeSource).toContain("mutation(request");
      expect(routeSource).toContain("requireIdempotencyKey(request)");
      expect(routeSource).toContain('createHash("sha256")');
    }
    expect(
      source("src/app/api/staff/operations/retention/[policyId]/route.ts"),
    ).toContain("p_retention_policy_revision_id: policyId");
    expect(
      source(
        "src/app/api/staff/operations/retention/requests/[requestId]/decision/route.ts",
      ),
    ).toContain("p_operations_evidence_event_id: input.evidenceEventId");
  });

  it("separates public liveness from protected detailed readiness", () => {
    const readiness = source("src/app/api/health/route.ts");
    const liveness = source("src/app/api/health/live/route.ts");
    const workflow = source(".github/workflows/production-pulse.yml");
    expect(readiness).toContain("canReadDetailedReadiness");
    expect(readiness).toContain("process.env.CRON_SECRET");
    expect(readiness).toContain('p_required_role: "platform_admin"');
    expect(readiness).toContain('{ status: "protected" }');
    expect(liveness).toContain('{ status: "live" }');
    expect(liveness).not.toContain("serviceSupabase");
    expect(liveness).not.toContain("productionReadiness");
    expect(workflow).toContain(
      '--header "Authorization: Bearer ${CRON_SECRET}"',
    );
    expect(workflow).toContain("/api/health/live");
  });
});
