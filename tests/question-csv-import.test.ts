import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseQuestionCsv,
  questionCsvHeaders,
  questionCsvTemplate,
} from "@/application/question-csv";

describe("question CSV import", () => {
  it("parses the downloadable template into one valid question", () => {
    const preview = parseQuestionCsv(questionCsvTemplate());

    expect(preview.errors).toEqual([]);
    expect(preview.questions).toHaveLength(1);
    expect(preview.questions[0]).toMatchObject({
      topic: "失智照護溝通",
      correctIndex: 1,
    });
    expect(preview.questions[0]?.options).toHaveLength(4);
  });

  it("supports quoted commas, newlines and doubled quotes", () => {
    const csv = [
      questionCsvHeaders.map((header) => `"${header}"`).join(","),
      [
        '"這是一個足夠長的測試題目？"',
        '"測試主題"',
        '"第一個選項"',
        '"含,逗號的選項"',
        '"含""引號的選項"',
        '"跨\n行選項"',
        '"B"',
        '"這是一段足夠長的答案說明。"',
      ].join(","),
    ].join("\r\n");

    const preview = parseQuestionCsv(csv);

    expect(preview.errors).toEqual([]);
    expect(preview.questions[0]?.correctIndex).toBe(1);
    expect(preview.questions[0]?.options).toEqual([
      "第一個選項",
      "含,逗號的選項",
      '含"引號的選項',
      "跨\n行選項",
    ]);
  });

  it("neutralizes spreadsheet formula prefixes before import", () => {
    const csv = questionCsvTemplate().replace(
      '"責備他不專心"',
      '"=HYPERLINK(""https://example.invalid"")"',
    );
    const preview = parseQuestionCsv(csv);

    expect(preview.errors).toEqual([]);
    expect(preview.sanitizedCells).toBe(1);
    expect(preview.questions[0]?.options[0]).toBe(
      '\'=HYPERLINK("https://example.invalid")',
    );
  });

  it("rejects invalid headers, invalid answers and batches over 200 rows", () => {
    const invalidHeader = parseQuestionCsv(
      questionCsvTemplate().replace('"題目"', '"問題"'),
    );
    expect(invalidHeader.errors[0]?.row).toBe(1);

    const invalidAnswer = parseQuestionCsv(
      questionCsvTemplate().replace(',"2",', ',"5",'),
    );
    expect(invalidAnswer.errors[0]?.message).toContain("1–4 或 A–D");

    const [header, row] = questionCsvTemplate().split("\r\n");
    const oversized = parseQuestionCsv(
      [header, ...Array.from({ length: 201 }, () => row)].join("\r\n"),
    );
    expect(oversized.errors[0]?.message).toContain("最多匯入 200 題");
  });

  it("uses an authenticated atomic RPC and renders it in the course editor", () => {
    const route = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/staff/courses/[courseVersionId]/questions/import/route.ts",
      ),
      "utf8",
    );
    const editor = readFileSync(
      resolve(process.cwd(), "src/components/course-editor.tsx"),
      "utf8",
    );
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260729181801_question_draft_batch_import.sql",
      ),
      "utf8",
    );

    expect(route).toContain("z.array(questionSchema).min(1).max(200)");
    expect(route).toContain("requireIdempotencyKey(request)");
    expect(route).toContain('"import_question_draft_batch"');
    expect(editor).toContain(
      "<QuestionCsvImporter courseVersionId={selectedDraft.id} />",
    );
    expect(migration).toContain("internal.import_question_draft_batch");
    expect(migration).toContain("for update of bank, version");
    expect(migration).toContain("'question_draft:batch_import'");
    expect(migration).toContain(
      "jsonb_array_length(submitted_questions) not between 1 and 200",
    );
    expect(migration).toContain(
      "grant execute on function public.import_question_draft_batch",
    );
  });

  it("ships a transaction-scoped twelve-assertion database fixture", () => {
    const fixture = readFileSync(
      resolve(
        process.cwd(),
        "supabase/tests/question_draft_batch_import.test.sql",
      ),
      "utf8",
    );

    expect(fixture.trimStart().startsWith("begin;")).toBe(true);
    expect(fixture.trimEnd().endsWith("rollback;")).toBe(true);
    expect(fixture).toContain("select extensions.plan(12);");
    expect(
      (
        fixture.match(
          /select extensions\.(?:ok|is|throws_ok|lives_ok|results_eq)\(/g,
        ) ?? []
      ).length,
    ).toBe(12);
  });
});
