import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724238100_runtime_lint_learning.sql",
  ),
  "utf8",
);

function functionBody(name: string) {
  const start = migration.indexOf(
    `create or replace function internal.${name}(`,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("\n$$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 4);
}

describe("runtime lint repairs for learning and live attendance", () => {
  it("replaces only the seven intended runtime functions", () => {
    const names = [
      "authorize_recorded_playback_without_hybrid_gate",
      "record_playback_heartbeat",
      "issue_live_join_lease_without_hybrid_gate",
      "select_assignment_live_session_without_hybrid_gate",
      "start_quiz_attempt_without_hybrid_gate",
      "submit_quiz_attempt",
      "settle_live_attendance",
    ];

    for (const name of names) {
      expect(
        migration.match(
          new RegExp(`create or replace function internal\\.${name}\\(`, "g"),
        ),
      ).toHaveLength(1);
    }

    expect(migration).not.toMatch(
      /^(?:alter|drop|truncate|create table|create view)\b/gim,
    );
  });

  it("uses the hosted pgcrypto schema explicitly for random bytes", () => {
    expect(migration.match(/extensions\.gen_random_bytes\(/g)).toHaveLength(6);
    expect(
      migration.replaceAll("extensions.gen_random_bytes", ""),
    ).not.toContain("gen_random_bytes(");
  });

  it("keeps privileged function execution grants fail closed", () => {
    for (const name of [
      "authorize_recorded_playback_without_hybrid_gate",
      "issue_live_join_lease_without_hybrid_gate",
      "select_assignment_live_session_without_hybrid_gate",
      "start_quiz_attempt_without_hybrid_gate",
    ]) {
      expect(migration).toContain(`internal.${name}`);
      expect(migration).toMatch(
        new RegExp(
          `internal\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
        ),
      );
    }

    expect(migration).toContain(
      "grant execute on function internal.record_playback_heartbeat(",
    );
    expect(migration).toContain(
      "grant execute on function internal.submit_quiz_attempt(uuid, jsonb, uuid)",
    );
    expect(migration).toContain(
      "grant execute on function internal.settle_live_attendance(uuid)",
    );
  });

  it("removes the quiz record collision without changing its gate", () => {
    const body = functionBody("start_quiz_attempt_without_hybrid_gate");
    expect(body).toContain("selected_question record;");
    expect(body).toContain("count(question_version.id)");
    expect(body).toContain("for selected_question in");
    expect(body).toContain("selected_question.prompt");
    expect(body).not.toMatch(/\n\s+question record;/);
    expect(body).toContain("set search_path = pg_catalog, public, private");
    expect(body).toContain("security definer");
  });

  it("counts submitted quiz object keys with supported catalog functions", () => {
    const body = functionBody("submit_quiz_attempt");
    expect(body).not.toContain("jsonb_object_length");
    expect(body).toContain(
      "coalesce(pg_catalog.jsonb_typeof(submitted_responses), 'null')",
    );
    expect(body).toContain(
      "from pg_catalog.jsonb_object_keys(submitted_responses)",
    );
    expect(body).toContain("if response_count <> 10 then");
    expect(body).toContain("submitted_response record;");
  });

  it("disambiguates the settled attendance summary variable", () => {
    const body = functionBody("settle_live_attendance");
    expect(body).toContain("settled_summary_id uuid;");
    expect(body).toContain("returning id into settled_summary_id;");
    expect(body).toContain(
      "where revision.attendance_summary_id = settled_summary_id;",
    );
    expect(body).toContain("settled_summary_id, next_revision, denominator,");
    expect(body).not.toContain(
      "where revision.attendance_summary_id = attendance_summary_id;",
    );
  });
});
