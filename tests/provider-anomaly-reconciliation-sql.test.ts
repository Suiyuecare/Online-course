import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724011632_live_hybrid.sql",
  ),
  "utf8",
);
const workflow = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724011637_rls_grants_bootstrap.sql",
  ),
  "utf8",
);

function shouldRevokeForCurrentEvidence(input: {
  priorQualified: boolean;
  currentQualified: boolean;
  bookingRequired: boolean;
  enrollmentLiveRequirementMet: boolean;
}) {
  return (
    input.priorQualified &&
    !input.currentQualified &&
    input.bookingRequired &&
    !input.enrollmentLiveRequirementMet
  );
}

describe("provider anomaly reconciliation", () => {
  it("requires append-only, distinct two-person resolution", () => {
    expect(schema).toContain(
      "create table public.provider_anomaly_resolution_requests",
    );
    expect(schema).toContain(
      "create table public.provider_anomaly_resolution_decisions",
    );
    expect(schema).toContain(
      "provider_anomaly_resolution_requests_append_only",
    );
    expect(schema).toContain(
      "provider_anomaly_resolution_decisions_append_only",
    );
    expect(workflow).toContain("internal.propose_provider_anomaly_resolution");
    expect(workflow).toContain("internal.decide_provider_anomaly_resolution");
    expect(workflow).toContain("DISTINCT_PROVIDER_ANOMALY_REVIEWER_REQUIRED");
    expect(workflow).toContain("internal.has_staff_role('course_admin')");
    expect(workflow).toContain(
      "internal.has_staff_role('accreditation_reviewer')",
    );
  });

  it("can recover with synthetic evidence or permanently disqualify", () => {
    expect(schema).toContain("'synthesize_left', 'accept_provider_evidence'");
    expect(workflow).toContain("'staff.participant_left'");
    expect(workflow).toContain("'dual_control_staff_resolution'");
    expect(workflow).toContain(
      "abort_reason = 'provider_anomaly_permanently_disqualified'",
    );
    expect(workflow).toContain("not booking.provider_disqualified");
  });

  it("caps provider presence at the authoritative meeting-ended time", () => {
    const settlement = workflow.slice(
      workflow.indexOf("function internal.settle_live_attendance"),
      workflow.indexOf("function public.settle_live_attendance"),
    );
    expect(settlement).toContain("authoritative_bounds as");
    expect(settlement).toContain("evidence.event_type = 'actual_ended'");
    expect(settlement).toContain(
      "least(segment_end, bounds.presence_ends_at) as segment_end",
    );
  });

  it("quarantines provider events received after immutable settlement", () => {
    const processor = workflow.slice(
      workflow.indexOf("function internal.process_provider_event"),
      workflow.indexOf("function public.process_provider_event"),
    );
    expect(processor).toContain("from public.attendance_summaries summary");
    expect(processor).toContain("for update of session");
    expect(processor).toContain("'late_provider_event_after_settlement'");
    expect(processor).toContain("'receivedAfterEvidenceCutoff'");
    expect(processor).toContain("'requiresDualControl', true");
    expect(processor).toContain("set status = 'reconciling'");
    expect(processor).toContain(
      "quarantine_reason = 'late_provider_event_after_settlement'",
    );
    expect(processor).toContain(
      "lease.duplicate_anomaly_at, event.received_at",
    );
    expect(workflow).toContain("'accept_provider_evidence'");
    expect(workflow).toContain("PROVIDER_ANOMALY_ACCEPTANCE_PAYLOAD_INVALID");
  });

  it("revises settled attendance and revokes invalid certificates", () => {
    const settlement = workflow.slice(
      workflow.indexOf("function internal.settle_live_attendance"),
      workflow.indexOf("function public.settle_live_attendance"),
    );
    expect(schema).toContain(
      "create table public.attendance_summary_revisions",
    );
    expect(schema).toContain("attendance_summary_revisions_append_only");
    expect(settlement).toContain("on conflict (live_booking_id) do update");
    expect(settlement).toContain(
      "insert into public.attendance_summary_revisions",
    );
    expect(settlement).toContain("'provider_anomaly_recompute'");
    expect(settlement).toContain(
      "internal.revoke_certificate_for_provider_anomaly",
    );
    expect(settlement).toContain("quarantined_at = null");
    expect(workflow).toContain("provider_anomaly.certificate_revoked");
    expect(workflow).toContain("current_status = 'revoked'");
    expect(workflow).toContain("set status = 'revoked'");
    expect(workflow).toContain(
      "then 'needs_correction'\n    else certificate.current_status",
    );
    expect(workflow).toContain(
      "target_status = 'accepted'\n         and exists",
    );
    expect(workflow).toContain("'late_provider_evidence_pending_review'");
  });

  it("deterministically reapplies every approved attendance correction", () => {
    const settlement = workflow.slice(
      workflow.indexOf("function internal.settle_live_attendance"),
      workflow.indexOf("function public.settle_live_attendance"),
    );
    expect(settlement).toContain(
      "join public.attendance_correction_decisions decision",
    );
    expect(settlement).toContain("decision.decision = 'approve'");
    expect(settlement).toContain("approved_correction_manifest");
    expect(settlement).toContain("effective_seconds + approved_presence_delta");
    expect(settlement).toContain("camera_seconds + approved_camera_delta");
    expect(settlement).toContain("':approved-corrections:'");
  });

  it("revokes only when the enrollment-wide live requirement fails", () => {
    const settlement = workflow.slice(
      workflow.indexOf("function internal.settle_live_attendance"),
      workflow.indexOf("function public.settle_live_attendance"),
    );
    const correctionDecision = workflow.slice(
      workflow.indexOf("function internal.decide_attendance_correction"),
      workflow.indexOf("function public.decide_attendance_correction"),
    );
    expect(workflow).toContain(
      "function internal.enrollment_live_requirements_met",
    );
    expect(workflow).toContain("function internal.live_booking_is_required");
    expect(settlement).toContain("prior_booking_qualified");
    expect(settlement).toContain("not computed_qualified");
    expect(settlement).toContain(
      "internal.live_booking_is_required(booking.id)",
    );
    expect(workflow).toContain(
      "internal.revoke_certificate_for_attendance_correction",
    );
    expect(correctionDecision).toContain("corrected_qualified");
    expect(correctionDecision).toContain("summary.qualified");
    expect(correctionDecision).toContain("not corrected_qualified");
    expect(correctionDecision).toContain(
      "internal.live_booking_is_required(summary.live_booking_id)",
    );
    expect(correctionDecision).toContain(
      "internal.enrollment_live_requirements_met",
    );
    expect(correctionDecision).toContain(
      "internal.revoke_certificate_for_attendance_correction",
    );
    expect(workflow).toContain("attendance_correction.certificate_revoked");
    expect(workflow).toContain("'attendance-correction-certificate-revoked:'");
  });

  it("enforces causal revocation for positive, optional, and required changes", () => {
    expect(
      shouldRevokeForCurrentEvidence({
        priorQualified: true,
        currentQualified: true,
        bookingRequired: true,
        enrollmentLiveRequirementMet: false,
      }),
    ).toBe(false);
    expect(
      shouldRevokeForCurrentEvidence({
        priorQualified: true,
        currentQualified: false,
        bookingRequired: false,
        enrollmentLiveRequirementMet: false,
      }),
    ).toBe(false);
    expect(
      shouldRevokeForCurrentEvidence({
        priorQualified: true,
        currentQualified: false,
        bookingRequired: true,
        enrollmentLiveRequirementMet: false,
      }),
    ).toBe(true);
  });

  it("does not immediately revoke an optional provider disqualification", () => {
    const decision = workflow.slice(
      workflow.indexOf("function internal.decide_provider_anomaly_resolution"),
      workflow.indexOf("function public.decide_provider_anomaly_resolution"),
    );
    expect(decision).toContain(
      "abort_reason = 'provider_anomaly_permanently_disqualified'",
    );
    expect(decision).not.toContain(
      "internal.revoke_certificate_for_provider_anomaly",
    );
  });

  it("keeps settlement blocked until every anomaly is resolved", () => {
    const settlement = workflow.slice(
      workflow.indexOf("function internal.settle_live_attendance"),
      workflow.indexOf("function public.settle_live_attendance"),
    );
    expect(settlement).toContain("lease.duplicate_anomaly_at is not null");
    expect(settlement).toContain("set status = 'reconciling'");
    expect(settlement).toContain("tstzmultirange");
    expect(settlement).not.toContain("generate_series");
    expect(workflow).toContain(
      "'live-attendance-settle:' || target_session::text",
    );
  });

  it("surfaces both proposal and second-review work in the staff queue", () => {
    expect(workflow).toContain("'provider_anomaly_propose'");
    expect(workflow).toContain("'provider_anomaly_decide'");
    expect(workflow).toContain("'Provider 異常待提案／覆核'");
    expect(workflow).toContain(
      "'allowedResolutionKinds',\n          jsonb_build_array(\n            'synthesize_left', 'accept_provider_evidence'",
    );
  });
});
