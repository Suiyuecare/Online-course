import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(directory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const expectedFiles = [
  "20260724011617_reset_legacy_application.sql",
  "20260724011618_identity_rbac_legal.sql",
  "20260724011622_catalog_graph_accreditation.sql",
  "20260724011626_manual_bank_commerce.sql",
  "20260724011629_recorded_learning_exam.sql",
  "20260724011632_live_hybrid.sql",
  "20260724011634_enterprise_points.sql",
  "20260724011635_certificates_exports_retention.sql",
  "20260724011636_operations_notifications.sql",
  "20260724011637_rls_grants_bootstrap.sql",
  "20260724071357_core_product_lifecycle_and_hybrid_gates.sql",
  "20260724180000_provider_operation_sagas.sql",
  "20260724220000_api_security_hardening.sql",
  "20260724230000_close_clean_launch_product_blockers.sql",
  "20260724234000_role_org_support_lifecycle.sql",
  "20260724235000_quality_revocation_preview.sql",
  "20260724236000_accreditation_submission_and_provider_ttl.sql",
  "20260724237000_quality_concurrency_hardening.sql",
  "20260724238000_runtime_lint_commerce.sql",
  "20260724238100_runtime_lint_learning.sql",
  "20260724238200_runtime_lint_org_accreditation.sql",
  "20260724238300_runtime_lint_course_instructor.sql",
  "20260727151249_fix_public_catalog_capabilities.sql",
  "20260728133925_professional_learner_profiles.sql",
  "20260728145659_learner_course_favorites.sql",
  "20260728154230_learner_account_settings.sql",
  "20260728154702_fix_request_person_id_rls_capability.sql",
  "20260728154828_fix_audit_owner_digest_capability.sql",
  "20260728161422_lock_learner_account_settings_server_write.sql",
  "20260728163345_learner_order_history.sql",
  "20260728165303_learner_order_history_indexes.sql",
  "20260729013748_order_history_safety_fixes.sql",
  "20260729013749_b2c_coupon_wallet.sql",
  "20260729165136_fix_learner_dashboard_and_org_rls_capabilities.sql",
  "20260729175514_organization_batch_assignments_with_deadlines.sql",
  "20260729181801_question_draft_batch_import.sql",
  "20260730031000_organization_lifecycle_controls.sql",
  "20260730033000_staff_directory_video_backup_workspace.sql",
  "20260730043000_course_content_release_gates.sql",
  "20260730051000_course_category_taxonomy.sql",
  "20260730052000_learner_server_cart.sql",
  "20260730053000_fix_course_category_audit_signature.sql",
  "20260730054000_reject_null_learner_cart_operations.sql",
];
if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Migration allowlist mismatch.\nExpected: ${expectedFiles.join(", ")}\nActual: ${files.join(", ")}`,
  );
}
const sql = files
  .map((file) => readFileSync(join(directory, file), "utf8"))
  .join("\n");

const count = (pattern) => (sql.match(pattern) ?? []).length;
const tables = count(/create\s+table\s+(?:public|private)\./gi);
const publicTables = count(/create\s+table\s+public\./gi);
const privateTables = count(/create\s+table\s+private\./gi);
const views = count(/create\s+or\s+replace\s+view\s+public\./gi);
const invokerViews = count(/security_invoker\s*=\s*true/gi);
const policies = count(/create\s+policy\s+/gi);
const functions = count(/create\s+or\s+replace\s+function\s+/gi);
const securityDefiners = count(/security\s+definer/gi);

const required = [
  "enable row level security",
  "force row level security",
  "revoke all on table %I.%I from public, anon, authenticated",
  "from anon, authenticated, service_role",
  "PUBLISHED_VERSION_IMMUTABLE",
  "APPEND_ONLY_TABLE",
  "MAINTENANCE_WRITE_FENCE",
  "ACTIVE_UNRESTRICTED_IDENTITY_REQUIRED",
  "FINANCE_THRESHOLD_MISSING",
  "OLD_ZOOM_CREDENTIAL_NOT_REVOKED",
  "HYBRID_GRAPH_CYCLE_OR_UNREACHABLE",
  "PROVIDER_RECEIPT_REPLAY_MISMATCH",
  "STREAM_UPLOAD_INTENT_REPLAY_MISMATCH",
  "internal.refresh_recorded_playback",
  "internal.lease_due_jobs_filtered",
  "orders_coupon_amounts_check",
  "coupon_one_active_use_per_claim",
  "internal.create_b2c_order_with_coupon",
  "COUPON_NOT_AVAILABLE",
  "coupon_reservation_released_before_late_payment",
  "own_attendance_summaries_read",
  "grant execute on function internal.has_organization_role(uuid, text[])",
  "grant select (entitlement_id)",
  "grant select (hold_expires_at)",
  "grant select (live_booking_id, quarantined_at)",
  "revoke all on function public.ingest_provider_event(",
  "'canReadThread', coalesce(support_case.assigned_to = actor, false)",
  "internal.batch_assign_organization_course",
  "completion_due_at",
  "read_organization_workspace_v3",
  "internal.import_question_draft_batch",
  "question_draft:batch_import",
  "internal.change_organization_status",
  "ORGANIZATION_STATUS_TRANSITION_REJECTED",
  "read_organization_lifecycle_controls",
  "organization.suspended",
  "organization.reactivated",
  "internal.read_staff_role_candidates",
  "read_video_master_backup_worklist",
  "masterBackupVerified",
  "COURSE_CONTENT_RELEASE_REQUIRED",
  "COURSE_CONTENT_NOT_AVAILABLE",
  "internal.assert_enrollment_content_available",
  "contentAvailableAt",
  "create table public.course_categories",
  "course_versions_published_category_check",
  "internal.create_course_draft_with_category",
  "internal.author_course_structure_with_category",
  "COURSE_CATEGORY_INVALID",
  "read_course_category_workspace",
  "category.code as category_code",
  "create table public.learner_cart_items",
  "learner_cart_items_owner_read",
  "internal.sync_own_learner_cart",
  "LEARNER_CART_COURSE_UNAVAILABLE",
  "rejectedCourseVersionIds",
];
for (const invariant of required) {
  if (!sql.includes(invariant))
    throw new Error(`Missing SQL invariant: ${invariant}`);
}
if (views !== invokerViews) {
  throw new Error(
    `Views are not all security_invoker (${invokerViews}/${views})`,
  );
}
const publicFunctionBlocks =
  sql.match(/create\s+or\s+replace\s+function\s+public\.[\s\S]*?\$\$;/gi) ?? [];
const publicDefinerCapabilities = new Set([
  "public.read_public_course_outline",
  "public.read_public_course_readiness",
]);
const foundPublicDefinerCapabilities = new Set();
for (const block of publicFunctionBlocks) {
  const functionName = block.match(
    /function\s+(public\.[a-z0-9_]+)\s*\(/i,
  )?.[1];
  if (/security\s+definer/i.test(block)) {
    if (!functionName || !publicDefinerCapabilities.has(functionName)) {
      throw new Error(
        `Unexpected SECURITY DEFINER function in exposed public schema: ${functionName ?? "unknown"}`,
      );
    }
    const implementationName = functionName.split(".")[1];
    if (
      !/set\s+search_path\s*=\s*pg_catalog,\s*internal/i.test(block) ||
      !new RegExp(
        `as\\s+\\$\\$\\s*select\\s+internal\\.${implementationName}` +
          `\\(p_course_version_id\\)\\s*\\$\\$;\\s*$`,
        "i",
      ).test(block)
    ) {
      throw new Error(
        `Public catalog capability is not a fixed internal facade: ${functionName}`,
      );
    }
    foundPublicDefinerCapabilities.add(functionName);
  } else if (!/security\s+invoker/i.test(block)) {
    throw new Error(
      `Public wrapper function missing SECURITY INVOKER: ${functionName ?? "unknown"}`,
    );
  }
}
if (
  foundPublicDefinerCapabilities.size !== publicDefinerCapabilities.size ||
  [...publicDefinerCapabilities].some(
    (name) => !foundPublicDefinerCapabilities.has(name),
  )
) {
  throw new Error("Public catalog capability facade set is incomplete");
}
const catalogCapabilityMigration = readFileSync(
  join(directory, "20260727151249_fix_public_catalog_capabilities.sql"),
  "utf8",
);
if (
  /grant\s+(?:all|select)\b[\s\S]*?\bon\s+(?:table\s+)?public\.course_versions\b[\s\S]*?\bto\s+(?:anon|authenticated)\b/i.test(
    catalogCapabilityMigration,
  ) ||
  /grant\s+usage\s+on\s+schema\s+internal\s+to\s+anon\b/i.test(
    catalogCapabilityMigration,
  )
) {
  throw new Error("Public catalog fix broadens a browser privilege");
}
for (const invariant of [
  "create role suiyue_catalog_owner nologin noinherit",
  "alter function public.read_public_course_outline(uuid)",
  "alter function public.read_public_course_readiness(uuid)",
  "owner to suiyue_catalog_owner",
  "revoke create on schema public from suiyue_catalog_owner",
  "rolbypassrls",
  "membership.admin_option",
  "member_role.rolname <> 'postgres'",
]) {
  if (!catalogCapabilityMigration.includes(invariant)) {
    throw new Error(
      `Missing public catalog capability invariant: ${invariant}`,
    );
  }
}
if (
  /drop\s+schema\s+(?:public|auth|storage|realtime|extensions|vault|graphql|supabase_migrations)\b/i.test(
    sql,
  )
) {
  throw new Error("System schema drop found");
}
const seed = readFileSync(join(process.cwd(), "supabase", "seed.sql"), "utf8");
if (
  /insert\s+into\s+.*(?:courses|people|orders|enrollments|certificates)/i.test(
    seed,
  )
) {
  throw new Error("Forbidden demonstration/business seed data found");
}

console.log("SQL invariant proof: PASS");
console.log(`Migrations: ${files.length}`);
console.log(
  `Tables: ${tables} (public ${publicTables}, private ${privateTables})`,
);
console.log(`Views: ${views} (security_invoker ${invokerViews})`);
console.log(`Policies: ${policies}`);
console.log(`Functions: ${functions} (SECURITY DEFINER ${securityDefiners})`);
console.log("RLS default-deny gate: PASS");
console.log("Explicit API-role revoke/grant matrix: PASS");
console.log("Append-only direct-DML revoke proof: PASS");
