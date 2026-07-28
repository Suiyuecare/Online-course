import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  join(process.cwd(), "supabase", "tests", "rls_role_matrix.test.sql"),
  "utf8",
);
const qualityFixture = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "tests",
    "quality_revocation_preview.test.sql",
  ),
  "utf8",
);
const favoriteFixture = readFileSync(
  join(process.cwd(), "supabase", "tests", "course_favorites.test.sql"),
  "utf8",
);

describe("Supabase pgTAP role matrix fixture", () => {
  it("is transaction-scoped with a matching pgTAP plan", () => {
    expect(fixture.trimStart().startsWith("begin;")).toBe(true);
    expect(fixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(fixture).toContain("select extensions.plan(28);");
    const assertions = (
      fixture.match(/select extensions\.(?:ok|results_eq)\(/g) ?? []
    ).length;
    expect(assertions).toBe(28);
    expect((fixture.match(/\$\$/g) ?? []).length % 2).toBe(0);
  });

  it("covers cross-person, cross-tenant and staff separation", () => {
    expect(fixture).toContain(
      "learner cannot read another learner notification",
    );
    expect(fixture).toContain(
      "organization owner cannot read another tenant wallet",
    );
    expect(fixture).toContain("support cannot escalate to finance");
    expect(fixture).toContain("finance cannot escalate to course admin");
    expect(fixture).toContain("course admin cannot escalate to finance");
  });

  it("proves provider evidence remains service-role only", () => {
    expect(fixture).toContain(
      "'public.ingest_provider_event(text,text,text,text,timestamptz,jsonb,text)'",
    );
    expect(fixture).toContain("authenticated cannot select provider evidence");
    expect(fixture).toContain("service role can read provider evidence");
  });

  it("proves exact runtime RPC privileges for browser and worker roles", () => {
    expect(fixture).toContain(
      "'authenticated', 'public.require_current_person()', 'execute'",
    );
    expect(fixture).toContain(
      "'authenticated', 'internal.require_current_person()', 'execute'",
    );
    expect(fixture).toContain(
      "'anon', 'public.require_current_person()', 'execute'",
    );
    expect(fixture).toContain(
      "'anon', 'internal.require_current_person()', 'execute'",
    );
    expect(fixture).toContain("'public.record_worker_heartbeat(text,boolean)'");
    expect(fixture).toContain(
      "'internal.record_worker_heartbeat(text,boolean)'",
    );
  });
});

describe("quality and preview pgTAP privilege fixture", () => {
  it("is transaction-scoped with a matching thirty-assertion plan", () => {
    expect(qualityFixture.trimStart().startsWith("begin;")).toBe(true);
    expect(qualityFixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(qualityFixture).toContain("select extensions.plan(30);");
    const assertions = (
      qualityFixture.match(/select extensions.(?:ok|results_eq|lives_ok)\(/g) ??
      []
    ).length;
    expect(assertions).toBe(30);
  });

  it("checks anonymous preview, table isolation, and fresh survey step-up", () => {
    expect(qualityFixture).toContain(
      "'public.authorize_public_course_preview(uuid,uuid)'",
    );
    expect(qualityFixture).toContain(
      "'public.quiz_attempt_invalidation_requests'",
    );
    expect(qualityFixture).toContain(
      "'public.read_survey_investigation(uuid,text,text)'",
    );
    expect(qualityFixture).toContain(
      "'public.read_survey_investigation(uuid,text)'",
    );
  });
});

describe("course favorite pgTAP privilege fixture", () => {
  it("is transaction-scoped with a matching ten-assertion plan", () => {
    expect(favoriteFixture.trimStart().startsWith("begin;")).toBe(true);
    expect(favoriteFixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(favoriteFixture).toContain("select extensions.plan(10);");
    const assertions = (
      favoriteFixture.match(
        /select extensions.(?:ok|results_eq|throws_ok|is)\(/g,
      ) ?? []
    ).length;
    expect(assertions).toBe(10);
  });

  it("proves owner isolation, narrow privileges, and draft rejection", () => {
    expect(favoriteFixture).toContain(
      "a learner reads only their own favorite",
    );
    expect(favoriteFixture).toContain(
      "a draft course cannot be added through the favorite RPC",
    );
    expect(favoriteFixture).toContain("does not touch another learner");
  });
});
