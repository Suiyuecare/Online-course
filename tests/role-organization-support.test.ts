import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const migration = source(
  "supabase/migrations/20260724234000_role_org_support_lifecycle.sql",
);

describe("instructor role lifecycle", () => {
  it("binds only active instructor roles and exposes an assigned-only dashboard", () => {
    expect(migration).toContain("ACTIVE_INSTRUCTOR_ROLE_REQUIRED");
    expect(migration).toContain("one_instructor_profile_per_person");
    expect(migration).toContain("course_instructors_require_active_role");
    expect(migration).toContain("course_submission_requires_bound_instructors");
    expect(migration).toContain("read_active_instructor_options");
    expect(migration).toContain("bind_course_instructor");
    expect(migration).toContain("read_instructor_dashboard");
    expect(migration).toContain("where link.instructor_id = profile_row.id");
  });

  it("uses a safe candidate list and never asks the course editor for phone data", () => {
    const editor = source("src/components/course-editor.tsx");
    const route = source(
      "src/app/api/staff/courses/[courseVersionId]/instructors/route.ts",
    );
    const dashboard = source("src/app/instructor/page.tsx");

    expect(editor).toContain("instructorRoleId");
    expect(editor).toContain("不會提供手機、Email");
    expect(editor).not.toMatch(/name=["'](?:phone|email|personId)["']/);
    expect(route).toContain('"bind_course_instructor"');
    expect(dashboard).toContain("匿名滿意度彙總");
    expect(dashboard).not.toMatch(/optionalComment|rawComment|comment/);
  });
});

describe("organization profile and offboarding", () => {
  it("enforces owner continuity, unsettled-work blockers, and frozen outcomes", () => {
    for (const invariant of [
      "ACTIVE_ORGANIZATION_OWNER_REQUIRED",
      "ACTIVE_OR_UNSETTLED_ASSIGNMENT_BLOCKS_OFFBOARDING",
      "ACTIVE_LIVE_BOOKING_BLOCKS_OFFBOARDING",
      "organization_assignment_outcome_snapshots",
      "organization_outcome_snapshots_append_only",
      "organization_assignment_visible_outcome",
      "read_organization_workspace_v2",
      "read_organization_training_report_v2",
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).toContain("actor_membership.role = 'training_manager'");
    expect(migration).toContain("target_membership.role <> 'member'");
    expect(migration).toContain("submitted_role <> 'member'");
  });

  it("routes profile and member changes through narrow RPCs", () => {
    const profileRoute = source(
      "src/app/api/organizations/[organizationId]/profile/route.ts",
    );
    const memberRoute = source(
      "src/app/api/organizations/[organizationId]/members/[personId]/route.ts",
    );
    const panel = source("src/components/organization-management-panel.tsx");
    const workspace = source("src/application/workspace.ts");

    expect(profileRoute).toContain('"update_organization_profile"');
    expect(memberRoute).toContain('"manage_organization_member"');
    expect(panel).toContain("至少保留一位負責人");
    expect(panel).toContain("之後不再顯示該人新的個人學習活動");
    expect(workspace).toContain('"read_organization_workspace_v3"');
  });

  it("derives funded completion from the authoritative enrollment only", () => {
    for (const invariant of [
      "organization_assignment_completion_guard",
      "enrollment_syncs_organization_assignment_completion",
      "organization_assignment_has_consumption_proof",
      "consume_organization_assignment_for_enrollment",
      "AUTHORITATIVE_ASSIGNMENT_COMPLETION_REQUIRED",
      "entitlement.source_type = 'organization_assignment'",
      "allocation.status = 'consumed'",
      "event.event_type = 'consumed'",
      "item.status = 'completed'",
      "enrollment.status in ('completed', 'submitted', 'credited')",
      "enrollment.completed_at is not null",
    ]) {
      expect(migration).toContain(invariant);
    }
  });

  it("uses the selected enrollment when an organization learner books live", () => {
    const liveSelectionSql = source(
      "supabase/migrations/20260724011637_rls_grants_bootstrap.sql",
    ).slice(
      source(
        "supabase/migrations/20260724011637_rls_grants_bootstrap.sql",
      ).indexOf(
        "create or replace function internal.select_assignment_live_session",
      ),
      source(
        "supabase/migrations/20260724011637_rls_grants_bootstrap.sql",
      ).indexOf(
        "revoke all on function internal.select_assignment_live_session",
      ),
    );

    expect(liveSelectionSql).toContain(
      "assignment_row.member_person_id, target_enrollment",
    );
    expect(liveSelectionSql).not.toContain(
      "assignment_row.member_person_id, enrollment_id",
    );
  });

  it("binds organization member idempotency to the canonical full request", () => {
    const memberSql = migration.slice(
      migration.indexOf(
        "create or replace function internal.manage_organization_member",
      ),
      migration.indexOf(
        "create or replace function public.manage_organization_member",
      ),
    );

    expect(memberSql).toContain("internal.canonical_request_hash");
    for (const field of [
      "'organizationId'",
      "'personId'",
      "'role'",
      "'active'",
      "'employeeNumber'",
      "'department'",
      "'reason'",
    ]) {
      expect(memberSql).toContain(field);
    }
    expect(memberSql).toContain("IDEMPOTENCY_KEY_REUSED");
  });

  it("canonicalizes instructor and organization profile idempotency payloads", () => {
    for (const [internalName, publicName, fields] of [
      [
        "internal.bind_course_instructor",
        "public.bind_course_instructor",
        [
          "'courseVersionId'",
          "'instructorRoleId'",
          "'displayName'",
          "'biography'",
          "'credentials'",
        ],
      ],
      [
        "internal.update_organization_profile",
        "public.update_organization_profile",
        [
          "'organizationId'",
          "'contactName'",
          "'contactEmail'",
          "'invoiceEmail'",
          "'invoiceRecipient'",
          "'invoiceAddress'",
        ],
      ],
    ] as const) {
      const functionSql = migration.slice(
        migration.indexOf(`create or replace function ${internalName}`),
        migration.indexOf(`create or replace function ${publicName}`),
      );

      expect(functionSql).toContain("internal.canonical_request_hash");
      expect(functionSql).not.toContain("extensions.digest(");
      for (const field of fields) {
        expect(functionSql).toContain(field);
      }
    }
  });
});

describe("support boundary", () => {
  it("keeps login recovery public while authenticated threads remain isolated", () => {
    const supportPage = source("src/app/support/page.tsx");
    const publicSupport = source("src/content/public-support.ts");
    const loginPage = source("src/app/login/page.tsx");

    expect(supportPage).toContain("function PublicSupportPage");
    expect(supportPage).toContain("if (!session)");
    expect(supportPage).not.toContain('redirect("/login")');
    expect(supportPage).toContain("歲悅客服不會向你索取完整簡訊驗證碼");
    expect(supportPage).toContain("publicSupportDefaults");
    expect(publicSupport).toContain("02-6604-5432");
    expect(loginPage).toContain('href="/support"');
    expect(loginPage).toContain("不必先登入");
  });

  it("keeps messages and case events append-only behind exact support role RPCs", () => {
    for (const invariant of [
      "support_case_messages_append_only",
      "support_case_events_append_only",
      "authorize_exact_staff_role",
      "customer_can_access_support_case",
      "read_support_queue",
      "ASSIGNED_SUPPORT_REPLY_REQUIRED",
      "ASSIGNED_SUPPORT_STATUS_REQUIRED",
      "ASSIGNED_SUPPORT_SLA_REQUIRED",
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).toContain(
      "'canReadThread', support_case.assigned_to = actor",
    );
    expect(migration).toContain("support_case.organization_id is null");
    expect(migration).toContain(
      "internal.customer_can_access_support_case(target_case)",
    );
    expect(migration).toContain("internal.redact_support_text");
  });

  it("never uses service authority or sensitive source tables in support routes", () => {
    const routes = [
      "src/app/api/support/cases/route.ts",
      "src/app/api/support/cases/[caseId]/messages/route.ts",
      "src/app/api/staff/support/cases/[caseId]/actions/route.ts",
    ].map(source);
    for (const route of routes) {
      expect(route).toContain("requireUser");
      expect(route).not.toContain("serviceSupabase");
    }

    const supportSql = migration.slice(
      migration.indexOf("internal.redact_support_text"),
    );
    for (const forbidden of [
      "accreditation_identity_profiles",
      "account_details_ciphertext",
      "question_answer_keys",
      "quiz_responses",
      "survey_response_revisions",
      "eligibility_snapshots",
    ]) {
      expect(supportSql).not.toContain(forbidden);
    }
  });

  it("mounts learner, organization, and masked staff support workflows", () => {
    const center = source("src/components/support-center.tsx");
    const queue = source("src/components/support-queue.tsx");
    const staffHome = source("src/app/staff/page.tsx");
    const header = source("src/components/site-header.tsx");

    expect(center).toContain("/api/support/cases");
    expect(center).toContain("請勿輸入身分證號");
    expect(queue).toContain("這是遮罩佇列");
    expect(queue).toContain("supportCase.safePreview");
    expect(queue).not.toContain("supportCase.summary");
    for (const action of ["assign", "reply", "status", "sla"]) {
      expect(queue).toContain(`action: "${action}"`);
    }
    expect(staffHome).toContain('href: "/staff/support"');
    expect(header).toContain('href="/support"');
  });

  it("returns original text only to the customer and a fixed preview to support", () => {
    const customerSql = migration.slice(
      migration.indexOf(
        "create or replace function internal.read_support_center",
      ),
      migration.indexOf(
        "create or replace function public.read_support_center",
      ),
    );
    const queueSql = migration.slice(
      migration.indexOf(
        "create or replace function internal.read_support_queue",
      ),
      migration.indexOf("revoke all on function internal.read_support_queue"),
    );

    expect(customerSql).toContain("'summary', support_case.summary");
    expect(customerSql).toContain("'body', message.body");
    expect(queueSql).toContain(
      "'safePreview', internal.support_safe_preview(support_case.kind)",
    );
    expect(queueSql).toContain("then '客戶內容需透過安全補件流程'");
    expect(queueSql).not.toContain("'summary', support_case.summary");
    expect(migration).toContain("[已遮罩電子郵件]");
    expect(migration).toContain("[已遮罩身分識別碼]");
    expect(migration).toContain("[已遮罩居留識別碼]");
    expect(migration).toContain("[已遮罩行動電話]");
    expect(migration).toContain("[已遮罩帳號或長數字]");
    expect(migration).toContain("[已遮罩長照人員識別碼]");
  });

  it("requires event-backed status projections and explicit wrapper grants", () => {
    expect(migration).toContain("support_cases_projection_guard");
    expect(migration).toContain("SUPPORT_CASE_DELETE_FORBIDDEN");
    expect(migration).toContain("SUPPORT_CASE_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SUPPORT_CASE_EVENT_REQUIRED");
    expect(migration).toContain("app.suiyue_support_case_event_id");
    expect(migration).toContain("alter column public_reference set default");
    expect(migration).toContain("alter default privileges in schema public");
    expect(migration).toContain(
      "revoke all on function public.read_support_queue()",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.read_support_queue()",
    );
  });

  it("hashes every support create, message, and action payload", () => {
    for (const functionName of [
      "internal.create_support_case",
      "internal.append_support_case_message",
      "internal.act_on_support_case",
    ]) {
      const start = migration.indexOf(
        `create or replace function ${functionName}`,
      );
      const end = migration.indexOf("revoke all on function", start);
      const functionSql = migration.slice(start, end);

      expect(functionSql).toContain("internal.canonical_request_hash");
      expect(functionSql).toContain("IDEMPOTENCY_KEY_REUSED");
      expect(functionSql).toContain("request_hash");
    }
  });
});
