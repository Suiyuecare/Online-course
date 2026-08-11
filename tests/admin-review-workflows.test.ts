import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  courseSubmissionReviewSchema,
  organizationApplicationReviewSchema,
} from "@/application/admin-review-workflows";

const root = process.cwd();
const migrationName = readdirSync(join(root, "supabase/migrations")).find(
  (file) => file.endsWith("_admin_review_workflows.sql"),
);
if (!migrationName) throw new Error("admin review migration missing");
const migration = readFileSync(
  join(root, "supabase/migrations", migrationName),
  "utf8",
);
const organizationReviewRoute = readFileSync(
  join(
    root,
    "src/app/api/staff/organizations/[organizationId]/review/route.ts",
  ),
  "utf8",
);
const courseSubmitRoute = readFileSync(
  join(root, "src/app/api/staff/courses/[courseVersionId]/submit/route.ts"),
  "utf8",
);
const coursePublishRoute = readFileSync(
  join(root, "src/app/api/staff/courses/[courseVersionId]/publish/route.ts"),
  "utf8",
);
const courseReviewRoute = readFileSync(
  join(root, "src/app/api/staff/courses/[courseVersionId]/review/route.ts"),
  "utf8",
);
const queuePage = readFileSync(
  join(root, "src/app/staff/[queue]/page.tsx"),
  "utf8",
);

describe("staff organization and course review workflows", () => {
  it("accepts only the deliberately masked organization projection", () => {
    const valid = {
      organizationId: "99400000-0000-4000-8000-000000000001",
      legalName: "歲悅照顧機構",
      taxIdMasked: "****1234",
      contactName: "王小美",
      contactEmailMasked: "w•••@example.test",
      invoiceEmailMasked: "f•••@example.test",
      status: "submitted",
      submittedAt: "2026-07-30T03:18:22.000Z",
      canReview: true,
    };
    expect(organizationApplicationReviewSchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      organizationApplicationReviewSchema.safeParse({
        ...valid,
        taxIdBlindIndex: "secret-index",
      }).success,
    ).toBe(false);
  });

  it("accepts only an in-review course submission projection", () => {
    const valid = {
      courseVersionId: "99400000-0000-4000-8000-000000000002",
      title: "失智照顧網路課程",
      version: 1,
      status: "in_review",
      submittedBy: "課程管理員",
      submittedAt: "2026-07-30T03:18:22.000Z",
      submissionReason: "內容已完成，敬請獨立覆核。",
      canDecide: true,
    };
    expect(courseSubmissionReviewSchema.safeParse(valid).success).toBe(true);
    expect(
      courseSubmissionReviewSchema.safeParse({
        ...valid,
        status: "draft",
      }).success,
    ).toBe(false);
  });

  it("persists and binds all accepted HTTP idempotency keys", () => {
    for (const route of [
      organizationReviewRoute,
      courseSubmitRoute,
      coursePublishRoute,
      courseReviewRoute,
    ]) {
      expect(route).toContain("requireIdempotencyKey(request)");
      expect(route).toContain("p_idempotency_key");
    }
    for (const operation of [
      "organization_application_review",
      "course_submit_review",
      "course_publish",
      "course_review_decision",
    ]) {
      expect(migration).toContain(`'${operation}'`);
    }
    expect(migration).toContain("IDEMPOTENCY_REQUEST_CONFLICT");
    expect(migration).toContain("internal.canonical_request_hash");
  });

  it("returns or rejects an in-review version without deleting authored work", () => {
    expect(courseReviewRoute).toContain('"return_for_correction"');
    expect(courseReviewRoute).toContain('"reject"');
    expect(migration).toContain("'course.returned_for_correction'");
    expect(migration).toContain("'course.review_rejected'");
    expect(migration).toContain("'contentPreserved', true");
    expect(migration).toContain("set status = 'draft'");
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(?:modules|lessons|course_materials|question_versions|course_instructors)/i,
    );
  });

  it("fails closed when a safe decision projection is unavailable", () => {
    expect(queuePage).toContain("readOrganizationApplicationReview");
    expect(queuePage).toContain("readCourseSubmissionReview");
    expect(queuePage).toContain("申請審核資料暫時無法讀取");
    expect(queuePage).toContain("課程送審資料暫時無法讀取");
    expect(queuePage).toContain("organizationApplicationReview?.canReview");
    expect(queuePage).toContain("courseSubmissionReview?.canDecide");
  });

  it("uses fixed search paths and explicit browser grants", () => {
    expect(migration).toContain(
      "create or replace function public.read_organization_application_review",
    );
    expect(migration).toContain(
      "create or replace function public.review_course_version_submission",
    );
    expect(migration).toMatch(
      /security invoker\s+stable\s+set search_path = pg_catalog, public, internal/,
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("to authenticated;");
  });
});
