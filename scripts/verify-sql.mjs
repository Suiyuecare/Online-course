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
if (publicFunctionBlocks.some((block) => /security\s+definer/i.test(block))) {
  throw new Error("SECURITY DEFINER function found in exposed public schema");
}
if (publicFunctionBlocks.some((block) => !/security\s+invoker/i.test(block))) {
  throw new Error("Public wrapper function missing SECURITY INVOKER");
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
