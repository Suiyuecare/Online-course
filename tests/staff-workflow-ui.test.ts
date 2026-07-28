import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("staff workflow UI safety", () => {
  it("keeps provider-anomaly dual control operable from the live queue", () => {
    const workspace = source("src/application/workspace.ts");
    const actions = source("src/components/staff-queue-actions.tsx");
    const proposal = source(
      "src/app/api/staff/live/provider-anomalies/[leaseId]/proposal/route.ts",
    );
    const decision = source(
      "src/app/api/staff/live/provider-anomalies/resolutions/[requestId]/decision/route.ts",
    );

    expect(workspace).toContain('"provider_anomaly_propose"');
    expect(workspace).toContain('"provider_anomaly_decide"');
    expect(actions).toContain("ProviderAnomalyProposalAction");
    expect(actions).toContain('"accept_provider_evidence"');
    expect(actions).toContain('case "provider_anomaly_decide"');
    expect(proposal).toContain('"propose_provider_anomaly_resolution"');
    expect(decision).toContain('"decide_provider_anomaly_resolution"');
  });

  it("does not retain the unmounted raw-ID staff panels", () => {
    for (const file of [
      "staff-action-panel.tsx",
      "accreditation-staff-panel.tsx",
      "course-authoring-panel.tsx",
      "refund-staff-panel.tsx",
      "bank-import-panel.tsx",
      "role-control-panel.tsx",
    ]) {
      expect(existsSync(join(root, "src/components", file))).toBe(false);
    }
  });

  it("uses selected context instead of editable UUID fields for live work", () => {
    const creation = source("src/components/live-staff-panel.tsx");
    const detail = source("src/components/live-session-management-panel.tsx");
    const unsafeIdInput =
      /<input\b[^>]*\bname="(?:courseVersionId|hybridComponentId|hostResourceId|liveSessionId|attendanceSummaryId|personId)"/;

    expect(creation).not.toMatch(unsafeIdInput);
    expect(detail).not.toMatch(unsafeIdInput);
    expect(creation).toContain("<select");
    expect(detail).toContain("liveSessionId");
  });

  it("keeps refund allocation on the course version, not the live session", () => {
    const route = source("src/app/api/staff/live/sessions/route.ts");
    const creation = source("src/components/live-staff-panel.tsx");

    expect(route).not.toContain("refundAllocation");
    expect(creation).not.toContain("refundAllocation");
  });

  it("downloads exports with a consumed POST capability, never a URL token", () => {
    const actions = source("src/components/staff-queue-actions.tsx");

    expect(actions).toContain(
      'fetch("/api/staff/accreditation/exports/download"',
    );
    expect(actions).toContain("JSON.stringify({ token: capability })");
    expect(actions).not.toMatch(/exports\/download\?/);
    expect(actions).not.toContain("localStorage");
  });

  it("mounts a label-driven course editor through the full review path", () => {
    const editor = source("src/components/course-editor.tsx");
    const queuePage = source("src/app/staff/[queue]/page.tsx");
    const unsafeIdInput =
      /<input\b[^>]*\bname="(?:courseVersionId|moduleId|lessonId|videoAssetId|legalDocumentId|retentionPolicyRevisionId|accreditationRevisionId)"/;

    expect(editor).not.toMatch(unsafeIdInput);
    expect(editor).toContain('post("/api/staff/courses/drafts"');
    expect(editor).toContain('post("/api/staff/stream/direct-upload"');
    expect(editor).toContain('upload.set("purpose", "course_material")');
    expect(editor).toContain("waitForCourseAssetScan");
    expect(editor).toContain('method: "POST"');
    expect(editor).toContain("/questions");
    expect(editor).toContain("/submit");
    expect(editor).toContain("<CourseDraftStructureManager");
    const manager = source("src/components/course-draft-structure-manager.tsx");
    for (const operation of [
      "module_update",
      "module_delete",
      "module_reorder",
      "lesson_update",
      "lesson_delete",
      "lesson_reorder",
      "instructor_update",
      "instructor_delete",
      "instructor_reorder",
      "question_update",
      "question_delete",
      "question_reorder",
    ]) {
      expect(manager).toContain(`operation: "${operation}"`);
    }
    expect(queuePage).toContain("/staff/courses/editor");
  });

  it("serves covers and learner materials through self-origin authorization", () => {
    const catalog = source("src/infrastructure/supabase/catalog.ts");
    const cover = source(
      "src/app/api/catalog/courses/[courseVersionId]/cover/route.ts",
    );
    const material = source(
      "src/app/api/learner/materials/[courseMaterialId]/download/route.ts",
    );
    const learningPage = source(
      "src/app/learner/courses/[enrollmentId]/page.tsx",
    );
    const courseRunner = source("src/components/learner-course-runner.tsx");

    expect(catalog).toContain("has_cover");
    expect(catalog).not.toContain("cover_path");
    expect(cover).toContain('.from("safe-uploads")');
    expect(cover).toContain('.from("published_course_catalog")');
    expect(cover).toContain('createHash("sha256")');
    expect(material).toContain('"read_learner_course_material_reference"');
    expect(material).toContain("resolveActivePerson");
    expect(material).toContain("COURSE_MATERIAL_INTEGRITY_FAILED");
    expect(learningPage).toContain("<LearnerCourseRunner");
    expect(courseRunner).toContain("<CourseMaterialDownloadButton");
  });

  it("serves the exact approved legal text and verifies every contract hash", () => {
    const route = source("src/app/api/legal/documents/[documentId]/route.ts");

    expect(route).toContain("inline://platform-prerequisite/");
    expect(route).toContain('.eq("materialized_target_id", documentId)');
    expect(route).toContain('createHash("sha256")');
    expect(route).toContain("document.content_sha256");
    expect(route).toContain("LEGAL_DOCUMENT_INTEGRITY_FAILED");
  });

  it("forces identity reviewers to unlock necessary plaintext before deciding", () => {
    const actions = source("src/components/staff-queue-actions.tsx");

    expect(actions).toContain(
      "`/api/staff/identity/${action.targetId}/access`",
    );
    expect(actions).toContain("雙人授權");
    expect(actions).toContain("{!identity ? (");
    expect(actions.indexOf("/access")).toBeLessThan(
      actions.indexOf("/decision"),
    );
  });

  it("mounts guided finance operations without editable internal IDs", () => {
    const panel = source("src/components/finance-bank-import-panel.tsx");
    const actions = source("src/components/staff-queue-actions.tsx");
    const queuePage = source("src/app/staff/[queue]/page.tsx");
    const unsafeIdInput =
      /<input\b[^>]*\bname="(?:quarantineId|batchId|invoiceId|refundCaseId|allocationId|disbursementId|subjectPersonId|requestId)"/;

    expect(panel).not.toMatch(unsafeIdInput);
    expect(actions).not.toMatch(unsafeIdInput);
    expect(panel).toContain('upload.set("purpose", "bank_statement")');
    expect(actions).toContain('case "invoice_result"');
    expect(actions).toContain('case "refund_disburse"');
    expect(actions).toContain('case "refund_disbursement_confirm"');
    expect(actions).toContain('case "role_change_request"');
    expect(actions).toContain('case "role_change_decide"');
    expect(queuePage).toContain("<FinanceBankImportPanel");
  });

  it("gives every invitation resend job a distinct SMS receipt key", () => {
    const worker = source("src/app/api/workers/wake/route.ts");
    const invitationRoute = source(
      "src/app/api/organizations/[organizationId]/invitations/[invitationId]/route.ts",
    );

    expect(worker).toContain(
      "organization-invitation:${invitationId}:${deliveryAttemptId}",
    );
    expect(invitationRoute).toContain('"manage_organization_invitation"');
    expect(invitationRoute).not.toContain("return { tokenHash");
  });
});
