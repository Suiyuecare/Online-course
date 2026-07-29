import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrations = migrationFiles
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

describe("clean migration chain", () => {
  it("has the ten responsibility-separated migrations and twenty-three forward hardening migrations", () => {
    expect(migrationFiles).toHaveLength(33);
    expect(migrationFiles.map((file) => file.replace(/^\d+_/, ""))).toEqual([
      "reset_legacy_application.sql",
      "identity_rbac_legal.sql",
      "catalog_graph_accreditation.sql",
      "manual_bank_commerce.sql",
      "recorded_learning_exam.sql",
      "live_hybrid.sql",
      "enterprise_points.sql",
      "certificates_exports_retention.sql",
      "operations_notifications.sql",
      "rls_grants_bootstrap.sql",
      "core_product_lifecycle_and_hybrid_gates.sql",
      "provider_operation_sagas.sql",
      "api_security_hardening.sql",
      "close_clean_launch_product_blockers.sql",
      "role_org_support_lifecycle.sql",
      "quality_revocation_preview.sql",
      "accreditation_submission_and_provider_ttl.sql",
      "quality_concurrency_hardening.sql",
      "runtime_lint_commerce.sql",
      "runtime_lint_learning.sql",
      "runtime_lint_org_accreditation.sql",
      "runtime_lint_course_instructor.sql",
      "fix_public_catalog_capabilities.sql",
      "professional_learner_profiles.sql",
      "learner_course_favorites.sql",
      "learner_account_settings.sql",
      "fix_request_person_id_rls_capability.sql",
      "fix_audit_owner_digest_capability.sql",
      "lock_learner_account_settings_server_write.sql",
      "learner_order_history.sql",
      "learner_order_history_indexes.sql",
      "order_history_safety_fixes.sql",
      "b2c_coupon_wallet.sql",
    ]);
  });

  it("does not use a broad system-schema drop", () => {
    expect(migrations).not.toMatch(
      /drop\s+schema\s+(?:public|auth|storage|realtime|extensions|vault|graphql|supabase_migrations)\b/i,
    );
    expect(migrations).not.toMatch(/drop\s+schema\s+[^;]+\s+cascade/i);
  });

  it("protects reset with project, fingerprint, and zero-data assertions", () => {
    expect(migrations).toContain("RESET_ABORTED_PROJECT_REF_MISMATCH");
    expect(migrations).toContain("RESET_ABORTED_LEGACY_FINGERPRINT_MISMATCH");
    expect(migrations).toContain("RESET_ABORTED_PROTECTED_DATA");
  });

  it("lets the hosted migration role assign isolated object owners", () => {
    expect(migrations).toContain(
      "grant suiyue_audit_owner, suiyue_money_owner to postgres",
    );
    expect(migrations).toContain(
      "grant usage, create on schema public to\n  suiyue_audit_owner, suiyue_money_owner",
    );
    expect(migrations).toContain(
      "grant usage, create on schema internal to suiyue_audit_owner",
    );
    expect(migrations).not.toMatch(
      /grant\s+suiyue_(?:audit|money)_owner\s+to\s+(?:anon|authenticated|service_role)/i,
    );
  });

  it("drops row-type-dependent legacy routines before their tables", () => {
    const reset = readFileSync(
      join(migrationDirectory, "20260724011617_reset_legacy_application.sql"),
      "utf8",
    );
    const routineDrop = reset.indexOf(
      "pg_get_function_identity_arguments(routine.oid) as identity_arguments",
    );
    const policyDrop = reset.indexOf("from pg_policies legacy_policy");
    const tableDrop = reset.indexOf(
      "select 'drop table ' || string_agg(candidate",
    );
    expect(policyDrop).toBeGreaterThan(-1);
    expect(routineDrop).toBeGreaterThan(-1);
    expect(routineDrop).toBeGreaterThan(policyDrop);
    expect(tableDrop).toBeGreaterThan(routineDrop);
  });

  it("does not mix a composite row target with scalar INTO targets", () => {
    const bootstrap = readFileSync(
      join(migrationDirectory, "20260724011637_rls_grants_bootstrap.sql"),
      "utf8",
    );
    expect(bootstrap).not.toMatch(
      /into\s+[a-z_][a-z0-9_]*_row\s*,\s*[a-z_][a-z0-9_]*/i,
    );
    expect(bootstrap).toContain("select lease.* into lease_row");
    expect(bootstrap).toContain("into target_session, provider_meeting_uuid");
  });

  it("starts every feature switch disabled", () => {
    expect(migrations).toContain("enabled boolean not null default false");
    expect(migrations).not.toMatch(
      /insert\s+into\s+public\.feature_switches[\s\S]{0,500}\btrue\b/i,
    );
  });

  it("seeds no course, order, person, enrollment, or completion", () => {
    const seed = readFileSync(
      join(process.cwd(), "supabase", "seed.sql"),
      "utf8",
    );
    expect(seed).not.toMatch(
      /insert\s+into\s+(?:public\.)?(?:courses|course_versions|people|orders|enrollments|certificates)\b/i,
    );
  });
});

describe("RLS, GRANT, and function proof", () => {
  it("default-denies every public/private table through one migration gate", () => {
    expect(migrations).toContain("alter table %I.%I enable row level security");
    expect(migrations).toContain("alter table %I.%I force row level security");
    expect(migrations).toContain(
      "revoke all on table %I.%I from public, anon, authenticated",
    );
  });

  it("makes every exposed view security-invoker", () => {
    const viewCount = (
      migrations.match(/create\s+or\s+replace\s+view\s+public\./gi) ?? []
    ).length;
    const invokerCount = (
      migrations.match(/with\s*\(\s*security_invoker\s*=\s*true\s*\)/gi) ?? []
    ).length;
    expect(viewCount).toBeGreaterThanOrEqual(4);
    expect(invokerCount).toBe(viewCount);
  });

  it("limits public SECURITY DEFINER functions to fixed catalog capabilities", () => {
    const publicFunctionBlocks =
      migrations.match(
        /create\s+or\s+replace\s+function\s+public\.[\s\S]*?\$\$;/gi,
      ) ?? [];
    const allowedDefiners = new Set([
      "public.read_public_course_outline",
      "public.read_public_course_readiness",
    ]);
    const foundDefiners = new Set<string>();
    for (const block of publicFunctionBlocks) {
      const functionName = block.match(
        /function\s+(public\.[a-z0-9_]+)\s*\(/i,
      )?.[1];
      if (/security\s+definer/i.test(block)) {
        expect(functionName).toBeDefined();
        if (!functionName) throw new Error("Public function name missing");
        expect(allowedDefiners.has(functionName)).toBe(true);
        expect(block).toMatch(
          /set\s+search_path\s*=\s*pg_catalog,\s*internal/i,
        );
        expect(block).toMatch(
          new RegExp(
            `as\\s+\\$\\$\\s*select\\s+internal\\.` +
              `${functionName.split(".")[1]}` +
              `\\(p_course_version_id\\)\\s*\\$\\$;\\s*$`,
            "i",
          ),
        );
        foundDefiners.add(functionName);
      } else {
        expect(block).toMatch(/security\s+invoker/i);
      }
    }
    expect(foundDefiners).toEqual(allowedDefiners);
  });

  it("fixes search_path for every SECURITY DEFINER function", () => {
    const definerBlocks =
      migrations.match(
        /create\s+or\s+replace\s+function\s+internal\.[\s\S]*?\$\$;/gi,
      ) ?? [];
    const securityDefiners = definerBlocks.filter((block) =>
      /security\s+definer/i.test(block),
    );
    expect(securityDefiners.length).toBeGreaterThan(10);
    for (const block of securityDefiners) {
      expect(block).toMatch(/set\s+search_path\s*=/i);
    }
  });

  it("revokes direct append-only mutation from every API role", () => {
    expect(migrations).toContain("from anon, authenticated, service_role");
    expect(migrations).toContain("APPEND_ONLY_TABLE");
    expect(migrations).toContain("public.audit_events");
    expect(migrations).toContain("public.point_ledger_events");
    expect(migrations).toContain("public.playback_events");
    expect(migrations).toContain("public.zoom_participant_events");
  });

  it("uses database locks and uniqueness at concurrency boundaries", () => {
    expect(migrations).toContain("for update skip locked");
    expect(migrations).toContain("one_active_recorded_lease_per_person");
    expect(migrations).toContain("one_active_live_lease_per_booking");
    expect(migrations).toContain("one_equivalent_live_booking");
    expect(migrations).toContain("no_zoom_host_collision");
    expect(migrations).toContain("BANK_TRANSACTION_ALLOCATION_OUT_OF_RANGE");
    expect(migrations).toContain("POINT_LEDGER_DRIFT");
    expect(migrations).toContain("PROVIDER_RECEIPT_REPLAY_MISMATCH");
    expect(migrations).toContain("STREAM_UPLOAD_INTENT_REPLAY_MISMATCH");
    expect(migrations).toContain("internal.refresh_recorded_playback");
    expect(migrations).toContain("internal.lease_due_jobs_filtered");
  });
});

describe("authority and exact provider claims", () => {
  it("keeps proof submission separate from payment finalization", () => {
    expect(migrations).toContain(
      "proof is evidence only and does not unlock access",
    );
    expect(migrations).toContain("internal.finalize_order_payment");
  });

  it("persists Zoom passcode only as encrypted private data", () => {
    expect(migrations).toContain("private.zoom_meetings");
    expect(migrations).toContain("encrypted_passcode jsonb not null");
    expect(migrations).not.toMatch(/meeting_passcode\s+text/i);
  });

  it("records camera state as evidence without biometric claims", () => {
    expect(migrations).toContain("camera_on boolean not null");
    expect(migrations).not.toMatch(/face_recognition|gaze_tracking/i);
  });

  it("keeps completion and credited as separate states", () => {
    expect(migrations).toContain(
      "'active', 'completed', 'submitted', 'credited'",
    );
    expect(migrations).toContain("accreditation_valid boolean not null");
  });

  it("persists accreditation identity only as encrypted envelopes", () => {
    expect(migrations).toContain(
      "create table private.accreditation_identity_profiles",
    );
    expect(migrations).toContain("encrypted_fields jsonb not null");
    expect(migrations).toContain("national_id_blind_index_current");
    expect(migrations).toContain("identity_verification_access_approvals");
  });

  it("consumes a short-lived assigned-reviewer capability before PII read", () => {
    expect(migrations).toContain(
      "create table private.identity_review_access_grants",
    );
    expect(migrations).toContain("consume_identity_review_access");
    expect(migrations).toContain(
      "verification_case.assigned_reviewer_id = target_actor",
    );
    expect(migrations).toContain("grant_row.consumed_at is null");
    expect(migrations).toContain("IDENTITY_REVIEW_DUAL_CONTROL_REQUIRED");
  });

  it("binds fresh TOTP grants to distinct sensitive actions", () => {
    for (const action of [
      "course_publish",
      "refund_account",
      "refund_disbursement",
      "point_refund_decision",
      "point_refund_account",
      "point_refund_result",
      "certificate_revoke",
      "identity_recovery",
    ]) {
      expect(migrations).toContain(`'${action}'`);
    }
    expect(migrations).toContain("grant_row.action = required_action");
    expect(migrations).toContain("grant_row.target = required_target");
    expect(migrations).toContain("grant_row.consumed_at is null");
  });

  it("invalidates pre-fence JWTs after role or identity changes", () => {
    expect(migrations).toContain("session_valid_after");
    expect(migrations).toContain("to_timestamp((auth.jwt() ->> 'iat')");
    expect(migrations).toContain("identity_epoch = identity_epoch + 1");
  });

  it("implements unused organization-point refunds as lot-locked events", () => {
    expect(migrations).toContain("create table public.point_refund_cases");
    expect(migrations).toContain("refund_reserved_points");
    expect(migrations).toContain("'refund_reserved'");
    expect(migrations).toContain("'refund_released'");
    expect(migrations).toContain("ONLY_UNUSED_POINTS_REFUNDABLE");
    expect(migrations).toContain("DISTINCT_POINT_REFUND_REVIEWER_REQUIRED");
  });

  it("keeps point refund account decryption one-time and server-mediated", () => {
    expect(migrations).toContain("authorize_point_refund_account_access");
    expect(migrations).toContain("consume_point_refund_account_access");
    expect(migrations).toContain("grant_row.consumed_at is null");
    expect(migrations).toContain("auth.role() <> 'service_role'");
  });

  it("durably reconciles Zoom reschedule and cancellation", () => {
    expect(migrations).toContain("'live_session_change'");
    expect(migrations).toContain("request_live_session_change");
    expect(migrations).toContain("read_live_session_change_context");
    expect(migrations).toContain("finalize_live_session_change");
    expect(migrations).toContain("calendar_sequence = calendar_sequence + 1");
  });

  it("requires instructor and safe material publication gates", () => {
    expect(migrations).toContain("ACTIVE_QUALIFIED_INSTRUCTOR_REQUIRED");
    expect(migrations).toContain("COURSE_MATERIAL_NOT_SAFE");
    expect(migrations).toContain("author_course_structure");
    expect(migrations).toContain("SAFE_COURSE_UPLOAD_REQUIRED");
  });

  it("binds publication to the same accreditation course and healthy providers", () => {
    expect(migrations).toContain(
      "decision_row.course_id <> version_row.course_id",
    );
    expect(migrations).toContain("ACCREDITATION_PARTIES_NOT_QUALIFIED");
    expect(migrations).toContain("OPERATING_CONFIGURATION_INCOMPLETE");
    expect(migrations).toContain("STREAM_PROVIDER_HEALTH_REQUIRED");
    expect(migrations).toContain("ZOOM_PROVIDER_HEALTH_REQUIRED");
  });

  it("provides a fresh-TOTP one-click fail-closed incident control", () => {
    expect(migrations).toContain("emergency_suspend_platform");
    expect(migrations).toContain("'emergency_suspend', 'all'");
    expect(migrations).toContain("allFeatureSwitchesDisabled");
    expect(migrations).toContain("'critical', 'contained'");
  });

  it("rechecks all completion authority before rendering and finalizing", () => {
    expect(migrations).toContain("read_completion_render_context");
    expect(migrations).toContain("COMPLETION_PREFLIGHT_CLOSED");
    expect(migrations).toContain("COMPLETION_REQUIREMENTS_NOT_MET");
    expect(migrations).toContain("certificate_pdf_sha256");
    expect(migrations).toContain("verification_token_hash");
  });

  it("keeps organization reports scoped and excludes raw learner evidence", () => {
    expect(migrations).toContain("read_organization_training_report");
    expect(migrations).toContain("masked organization-funded training report");
    const reportBlock = migrations.slice(
      migrations.indexOf("read_organization_training_report"),
      migrations.indexOf(
        "create or replace function public.read_organization_training_report",
      ),
    );
    expect(reportBlock).not.toContain("national_id");
    expect(reportBlock).not.toContain("quiz_responses");
    expect(reportBlock).not.toContain("survey_response_revisions");
  });

  it("backs staff queues with database counts rather than demo records", () => {
    expect(migrations).toContain("read_staff_queue_counts");
    expect(migrations).toContain("status = 'dead_letter'");
    expect(migrations).toContain("status = 'reconciling'");
    expect(migrations).toContain("status not in ('completed', 'rejected')");
  });
});
