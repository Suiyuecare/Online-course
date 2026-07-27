import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260727151249_fix_public_catalog_capabilities.sql",
);
const fixture = source("supabase/tests/quality_revocation_preview.test.sql");
const sqlProof = source("scripts/verify-sql.mjs");

function functionBlock(name: string) {
  const marker = `create or replace function public.${name}(`;
  const start = migration.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("\n$$;", start);
  expect(end, `${name} must have a complete body`).toBeGreaterThan(start);
  return migration.slice(start, end + 4);
}

describe("public catalog capability forward fix", () => {
  it("keeps the catalog security-invoker and avoids whole-row privileges", () => {
    expect(migration).toContain(
      "create or replace view public.published_course_catalog\n" +
        "with (security_invoker = true)",
    );
    expect(migration).not.toContain("candidate.*");
    expect(migration).not.toContain("decision.*");
    expect(migration).toContain("candidate.minimum_completion_window");
    expect(migration).toContain("decision.valid_until");
    expect(migration).not.toMatch(
      /grant\s+(?:all|select)\b[\s\S]*?\bon\s+(?:table\s+)?public\.course_versions\b[\s\S]*?\bto\s+(?:anon|authenticated)\b/i,
    );
    expect(migration).not.toMatch(
      /grant\s+usage\s+on\s+schema\s+internal\s+to\s+anon\b/i,
    );
    expect(migration).toContain(
      "grant select on public.published_course_catalog\n" +
        "  to anon, authenticated, service_role;",
    );
  });

  it("uses a no-login, no-inherit owner with no persistent create grant", () => {
    expect(migration).toContain(
      "create role suiyue_catalog_owner nologin noinherit;",
    );
    expect(migration).toContain(
      "SUIYUE_CATALOG_OWNER_SECURITY_CONTRACT_CHANGED",
    );
    for (const privilegedFlag of [
      "rolsuper",
      "rolcreaterole",
      "rolcreatedb",
      "rolreplication",
      "rolbypassrls",
      "membership.admin_option",
    ]) {
      expect(migration).toContain(privilegedFlag);
      expect(fixture).toContain(privilegedFlag);
    }
    expect(migration).toContain("member_role.rolname <> 'postgres'");
    expect(migration).toContain(
      "revoke all privileges on all tables in schema public\n" +
        "  from suiyue_catalog_owner;",
    );
    expect(migration).toContain(
      "revoke create on schema public from suiyue_catalog_owner;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:all|select|insert|update|delete)\b[^;]*\bon\s+(?:table\s+)?public\.[a-z0-9_]+\b[^;]*\bto\s+suiyue_catalog_owner\s*;/i,
    );
  });

  it("limits both public definers to fixed internal read calls", () => {
    for (const name of [
      "read_public_course_outline",
      "read_public_course_readiness",
    ]) {
      const block = functionBlock(name);
      expect(block).toContain("security definer");
      expect(block).toContain("set search_path = pg_catalog, internal");
      expect(block).toContain(`select internal.${name}(p_course_version_id)`);
      expect(block).toMatch(
        new RegExp(
          `as\\s+\\$\\$\\s*select\\s+internal\\.${name}` +
            `\\(p_course_version_id\\)\\s*\\$\\$;\\s*$`,
          "i",
        ),
      );
      expect(block).not.toMatch(/\bexecute\b|\bformat\s*\(/i);
      expect(migration).toContain(
        `alter function public.${name}(uuid)\n` +
          "  owner to suiyue_catalog_owner;",
      );
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\(uuid\\)` +
            `\\s+from public, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\(uuid\\)` +
            `\\s+to anon, authenticated;`,
        ),
      );
    }
  });

  it("removes direct browser execution of the internal readers", () => {
    for (const name of [
      "read_public_course_outline",
      "read_public_course_readiness",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function internal\\.${name}\\(uuid\\)` +
            `\\s+from public, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function internal\\.${name}\\(uuid\\)` +
            `\\s+to suiyue_catalog_owner;`,
        ),
      );
    }
  });

  it("extends the rollback-safe pgTAP fixture with runtime role checks", () => {
    expect(fixture.trimStart()).toMatch(/^begin;/);
    expect(fixture).toContain("select extensions.plan(30)");
    expect(fixture).toContain("set local role anon;");
    expect(fixture).toContain(
      "anonymous visitors can evaluate the exact frontend catalog projection",
    );
    expect(fixture).toContain(
      "an unknown course has an empty public outline without a permission error",
    );
    expect(fixture).toContain(
      "an unknown course fails purchase readiness without a permission error",
    );
    expect(fixture).toContain(
      "the server cover route can evaluate the security-invoker catalog",
    );
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
  });

  it("teaches the SQL proof to reject any broader public definer", () => {
    expect(sqlProof).toContain("publicDefinerCapabilities");
    expect(sqlProof).toContain(
      "Public catalog fix broadens a browser privilege",
    );
    expect(sqlProof).toContain(
      "20260727151249_fix_public_catalog_capabilities.sql",
    );
  });
});
