import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724238300_runtime_lint_course_instructor.sql",
  ),
  "utf8",
);

const previousMigration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724238200_runtime_lint_org_accreditation.sql",
  ),
  "utf8",
);

const oldNeedles = [
  "\n  instructor_id uuid;",
  ") returning id into instructor_id;",
  ") values (target_version, instructor_id, next_sort);",
  "result := jsonb_build_object('instructorId', instructor_id);",
];

const newNeedles = [
  "\n  created_instructor_id uuid;",
  ") returning id into created_instructor_id;",
  ") values (target_version, created_instructor_id, next_sort);",
  "result := jsonb_build_object('instructorId', created_instructor_id);",
];

function previousAuthorFunction() {
  const marker = "create or replace function internal.author_course_structure(";
  const start = previousMigration.indexOf(marker);
  const end = previousMigration.indexOf("\n$$;", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return previousMigration.slice(start, end + 4);
}

describe("course instructor runtime lint forward fix", () => {
  it("targets only the existing internal authoring function", () => {
    expect(migration).toContain(
      "'internal.author_course_structure(uuid,text,jsonb,uuid)'",
    );
    expect(migration).toContain("pg_get_functiondef(function.oid)");
    expect(migration).not.toMatch(/^create or replace function public\./m);
    expect(migration).not.toMatch(/^(?:drop|alter) (?:table|function)\b/im);
    expect(migration).not.toMatch(/^create table\b/im);
  });

  it("fails closed unless every expected replacement is unique and complete", () => {
    expect(migration).toContain("old_count + new_count <> 1");
    expect(migration).toContain(
      "old_total not in (0, array_length(old_needles, 1))",
    );
    expect(migration).toContain("'COURSE_INSTRUCTOR_IDENTIFIER_PARTIAL_STATE'");
    expect(migration).toContain(
      "'FUNCTION_SECURITY_CONTRACT_CHANGED: " +
        "internal.author_course_structure'",
    );
  });

  it("renames only the local created-instructor value references", () => {
    let transformed = previousAuthorFunction();

    for (let index = 0; index < oldNeedles.length; index += 1) {
      expect(transformed.split(oldNeedles[index]).length - 1).toBe(1);
      expect(transformed).not.toContain(newNeedles[index]);
      transformed = transformed.replace(oldNeedles[index], newNeedles[index]);
    }

    for (const needle of oldNeedles) {
      expect(transformed).not.toContain(needle);
    }
    for (const needle of newNeedles) {
      expect(transformed).toContain(needle);
    }

    expect(transformed).toContain(
      "course_version_id, instructor_id, sort_order",
    );
    expect(transformed).toContain("and instructor_id = target_instructor_id;");
    expect(transformed).toContain(
      "where instructor_id = ordered_item.item_id::uuid",
    );
  });

  it("preserves the security-definer contract and reasserts the ACL", () => {
    expect(migration).toContain("function.prosecdef");
    expect(migration).toContain(
      "function_config @> array['search_path=pg_catalog, public']",
    );
    expect(migration).toContain(
      "revoke all on function internal.author_course_structure(",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(migration).toMatch(
      /grant execute on function internal\.author_course_structure\([\s\S]*?\)\s+to authenticated;/,
    );
  });
});
