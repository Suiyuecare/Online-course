import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724238200_runtime_lint_org_accreditation.sql",
  ),
  "utf8",
);

function internalFunction(name: string) {
  const marker = `create or replace function internal.${name}(`;
  const start = migration.indexOf(marker);
  expect(
    start,
    `${name} must exist in the forward migration`,
  ).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("\n$$;", start);
  expect(end, `${name} must have a complete body`).toBeGreaterThan(start);
  return migration.slice(start, end + 4);
}

describe("organization and accreditation runtime lint forward fix", () => {
  it("contains only the nine intended internal function replacements", () => {
    const replacements =
      migration.match(/^create or replace function internal\./gm) ?? [];

    expect(replacements).toHaveLength(9);
    expect(migration).not.toMatch(/^create or replace function public\./m);
    expect(migration).not.toMatch(/^(?:drop|alter) (?:table|function)\b/im);
    expect(migration).not.toMatch(/^create table\b/im);
  });

  it("keeps publication validation inside the existing internal function", () => {
    const sql = internalFunction("publish_course_version");

    expect(sql).not.toContain("jsonb_object_length");
    expect(
      sql.match(
        /from jsonb_object_keys\(version_row\.live_refund_allocations\)/g,
      ),
    ).toHaveLength(2);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, public");
  });

  it("separates the organization completion record from SQL aliases", () => {
    const sql = internalFunction("manage_organization_member");

    expect(sql).toContain("completed_assignment record;");
    expect(sql).toContain("for completed_assignment in");
    expect(sql).toContain("completed_assignment.id");
    expect(sql).not.toMatch(/^\s*assignment record;/m);
    expect(sql).not.toContain("for assignment in");
    expect(sql).toContain("from public.organization_assignments assignment");
  });

  it("separates the created batch id from batch_id columns", () => {
    const sql = internalFunction("create_accreditation_submission_batch");

    expect(sql).toContain("created_batch_id uuid;");
    expect(sql).toContain("returning id into created_batch_id");
    expect(sql).toContain("item.batch_id = created_batch_id");
    expect(sql).toContain("return created_batch_id;");
    expect(sql).not.toMatch(/\binto batch_id\b|= batch_id\b|return batch_id\b/);
  });

  it("uses the invitation constraint and explicit email parameter aliases", () => {
    const invitation = internalFunction("create_organization_invitation");
    const startEmail = internalFunction("start_email_verification");
    const confirmEmail = internalFunction("confirm_email_verification");

    expect(invitation).toContain(
      "on conflict on constraint\n" +
        "    organization_invitations_organization_id_phone_blind_index_key",
    );
    expect(invitation).not.toContain(
      "on conflict (organization_id, phone_blind_index)",
    );

    expect(startEmail).toContain("input_normalized_email alias for $1;");
    expect(startEmail).toContain("= lower(input_normalized_email)");
    expect(startEmail).toContain("actor, lower(input_normalized_email)");
    expect(confirmEmail).toContain("input_normalized_email alias for $1;");
    expect(confirmEmail).toContain("= lower(input_normalized_email)");
    expect(confirmEmail).toContain(
      "set verified_email = lower(input_normalized_email)",
    );
  });

  it("separates calculated request hashes from stored columns", () => {
    for (const name of ["manage_question_draft", "author_course_structure"]) {
      const sql = internalFunction(name);

      expect(sql).toContain("calculated_request_hash text;");
      expect(sql).toContain("record.request_hash = calculated_request_hash");
      expect(sql).toContain(
        "actor_id, operation, idempotency_key, request_hash, locked_until",
      );
      expect(sql).not.toMatch(/\n  request_hash text;|\n  request_hash :=/);
      expect(sql).not.toMatch(/record\.request_hash = request_hash\b/);
    }
  });

  it("keeps the approval SQL alias distinct from the refundable order record", () => {
    const sql = internalFunction("apply_accreditation_transition_effects");

    expect(sql).toContain("refundable_order record;");
    expect(sql).toContain("update public.orders order_row");
    expect(sql).toContain("for refundable_order in");
    expect(sql).toContain("refund.order_id = refundable_order.id");
    expect(sql).not.toContain("order_row record;");
    expect(sql).not.toContain("for order_row in");
  });

  it("reasserts the existing internal execution boundary", () => {
    const authenticatedFunctions = [
      "publish_course_version",
      "manage_organization_member",
      "create_accreditation_submission_batch",
      "create_organization_invitation",
      "start_email_verification",
      "confirm_email_verification",
      "manage_question_draft",
      "author_course_structure",
    ];

    for (const name of authenticatedFunctions) {
      expect(migration).toContain(`revoke all on function internal.${name}(`);
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function internal\\.${name}\\([\\s\\S]*?\\)` +
            `\\s+to authenticated;`,
        ),
      );
    }
    expect(migration).toContain(
      "revoke all on function internal.apply_accreditation_transition_effects(",
    );
    expect(migration).not.toMatch(
      /grant execute on function internal\.apply_accreditation_transition_effects/,
    );
  });
});
