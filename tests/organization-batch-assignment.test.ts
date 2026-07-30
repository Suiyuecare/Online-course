import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const migration = source(
  "supabase/migrations/20260729175514_organization_batch_assignments_with_deadlines.sql",
);
const fixture = source(
  "supabase/tests/organization_batch_assignments.test.sql",
);

function internalBatchFunction() {
  const start = migration.indexOf(
    "create or replace function internal.batch_assign_organization_course(",
  );
  const end = migration.indexOf(
    "revoke all on function internal.batch_assign_organization_course(",
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("organization batch assignment database contract", () => {
  it("adds a learner-visible deadline without opening assignment tables", () => {
    expect(migration).toContain(
      "alter table public.enrollments\n  add column completion_due_at timestamptz",
    );
    expect(migration).toContain(
      "create index enrollments_open_completion_due_idx",
    );
    expect(migration).toContain("with (security_invoker = true)");
    expect(migration).toContain("enrollment.completion_due_at");
    expect(migration).toContain("read_organization_workspace_v3");
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,80}public\.organization_assignments\s+to\s+authenticated/i,
    );
  });

  it("authorizes and locks the exact organization boundary", () => {
    const sql = internalBatchFunction();

    expect(sql).toContain("membership.organization_id = target_organization");
    expect(sql).toContain("membership.person_id = actor");
    expect(sql).toContain("membership.role in ('owner', 'training_manager')");
    expect(sql).toContain("for share of membership, organization");
    expect(sql).toContain("membership.person_id = member_id");
    expect(sql).toContain("for share of membership");
    expect(sql).toContain("ORGANIZATION_MEMBER_REQUIRED");
  });

  it("binds idempotency to the complete canonical request and replays it", () => {
    const sql = internalBatchFunction();

    expect(sql).toContain("internal.canonical_request_hash");
    for (const field of [
      "'organizationId'",
      "'memberPersonIds'",
      "'courseVersionId'",
      "'liveSessionId'",
      "'completionDueAt'",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain(
      "on conflict (actor_id, operation, idempotency_key) do nothing",
    );
    expect(sql).toContain("return prior.response_body");
    expect(sql).toContain("IDEMPOTENCY_REQUEST_CONFLICT");
  });

  it("uses a row subtransaction and never swallows ledger invariants", () => {
    const sql = internalBatchFunction();
    const rowBlock = sql.slice(
      sql.indexOf("foreach member_id in array target_members"),
    );

    expect(rowBlock).toContain("assignment_result :=");
    expect(rowBlock).toContain("internal.assign_organization_course(");
    expect(rowBlock).toContain("internal.select_assignment_live_session(");
    expect(rowBlock).toContain("exception");
    expect(rowBlock).toContain("when unique_violation");
    expect(rowBlock).toContain(
      "A unique violation from the ledger, entitlement or booking graph",
    );
    expect(rowBlock).toContain(
      "assignment.course_version_id = target_course_version",
    );
    expect(rowBlock).toContain("when raise_exception");
    expect(rowBlock).toContain("if failure_code not in (");
    expect(rowBlock).toMatch(
      /if failure_code not in \([\s\S]*?\) then\s+raise;/,
    );
    const safeFailureAllowList = rowBlock.slice(
      rowBlock.indexOf("if failure_code not in ("),
      rowBlock.indexOf(") then", rowBlock.indexOf("if failure_code not in (")),
    );
    expect(safeFailureAllowList).not.toContain("'POINT_LEDGER_DRIFT'");
    expect(safeFailureAllowList).not.toContain(
      "'ASSIGNMENT_ENROLLMENT_MISSING'",
    );
  });

  it("keeps wrapper grants narrow and explicit", () => {
    expect(migration).toContain(
      "revoke all on function public.batch_assign_organization_course(",
    );
    expect(migration).toContain(
      ") from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.batch_assign_organization_course(",
    );
    expect(migration).toMatch(
      /grant execute on function public\.batch_assign_organization_course\([\s\S]*?\) to authenticated;/,
    );
    expect(migration).not.toMatch(
      /batch_assign_organization_course\([\s\S]*?\) to anon;/,
    );
  });
});

describe("organization batch assignment API and UI", () => {
  it("validates a bounded unique member list and all command identifiers", () => {
    const route = source(
      "src/app/api/organizations/[organizationId]/assignments/batch/route.ts",
    );

    expect(route).toContain(".array(z.uuid())");
    expect(route).toContain(".min(1)");
    expect(route).toContain(".max(200)");
    expect(route).toContain("DUPLICATE_MEMBER_SELECTION");
    expect(route).toContain("courseVersionId: z.uuid()");
    expect(route).toContain("liveSessionId: z.uuid().nullable().optional()");
    expect(route).toContain("z.iso.datetime({ offset: true })");
    expect(route).toContain("requireIdempotencyKey(request)");
    expect(route).toContain("batchAssignOrganizationCourse");
  });

  it("offers real multi-select, optional deadline, live session and row results", () => {
    const component = source(
      "src/components/organization-batch-assignment.tsx",
    );
    const workspace = source("src/app/organization/workspace/page.tsx");

    for (const label of [
      "一次指派多位員工",
      "完成期限（選填）",
      "全選目前有效成員",
      "逐列結果",
      "失敗列沒有扣點",
    ]) {
      expect(component).toContain(label);
    }
    expect(component).toContain("liveSessionId");
    expect(component).toContain("idempotencyKey: crypto.randomUUID()");
    expect(component).toContain("router.refresh()");
    expect(workspace).toContain("liveSessions: course.live_sessions.map");
    expect(workspace).toContain("displayName: member.displayName");
  });

  it("shows the deadline in both manager and learner workspaces", () => {
    const organizationRecords = source(
      "src/components/organization-records.tsx",
    );
    const learnerCenter = source("src/application/learner-center.ts");
    const learnerPage = source("src/app/learner/page.tsx");

    expect(organizationRecords).toContain("assignment.completionDueAt");
    expect(learnerCenter).toContain("completion_due_at");
    expect(learnerPage).toContain("機構完成期限");
  });
});

describe("organization batch assignment pgTAP fixture", () => {
  it("is transaction-scoped with a matching eighteen-assertion plan", () => {
    expect(fixture.trimStart().startsWith("begin;")).toBe(true);
    expect(fixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(fixture).toContain("select extensions.plan(18);");
    const assertions = (
      fixture.match(
        /select extensions\.(?:ok|is|throws_ok|lives_ok|results_eq)\(/g,
      ) ?? []
    ).length;
    expect(assertions).toBe(18);
  });

  it("covers partial failure, replay, insufficient funds and tenant isolation", () => {
    for (const proof of [
      "one cross-tenant member fails without rolling back valid rows",
      "an identical idempotent replay returns the original row results",
      "insufficient points fail only that member row",
      "a manager from another organization cannot operate the target wallet",
      "the assigned learner sees the organization completion deadline",
      "append-only point evidence exists exactly once per successful row",
    ]) {
      expect(fixture).toContain(proof);
    }
  });
});
