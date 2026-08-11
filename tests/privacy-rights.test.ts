import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  privacyRequestInputSchema,
  privacyRequestOptions,
} from "@/domain/privacy-rights";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("learner privacy rights workflow", () => {
  it("validates the four supported requests without accepting an instant delete", () => {
    expect(privacyRequestOptions.map((option) => option.value)).toEqual([
      "access",
      "correction",
      "restriction",
      "deletion",
    ]);
    expect(
      privacyRequestInputSchema.safeParse({
        requestType: "deletion",
        detail: "請協助停用帳號並說明依法需要保留哪些紀錄。",
        acknowledged: true,
      }).success,
    ).toBe(true);
    expect(
      privacyRequestInputSchema.safeParse({
        requestType: "deletion",
        detail: "立即刪除",
        acknowledged: false,
      }).success,
    ).toBe(false);
  });

  it("creates an idempotent personal support case and exposes safe status history", () => {
    const route = source("src/app/api/privacy/requests/route.ts");
    const page = source("src/app/learner/privacy/page.tsx");
    const component = source("src/components/privacy-rights-center.tsx");
    const migration = source(
      "supabase/migrations/20260730062000_privacy_rights_support.sql",
    );

    expect(route).toContain("requireIdempotencyKey");
    expect(route).toContain('p_kind: "privacy"');
    expect(route).toContain("p_organization_id: null");
    expect(page).toContain('item.kind === "privacy"');
    expect(component).toContain(
      "不代表訂單、付款、積分、證明及稽核資料會立即消失",
    );
    expect(component).toContain("依法保留的範圍");
    expect(component).toContain('aria-live="polite"');
    expect(migration).toContain("when 'privacy' then '個資與帳號權利案件'");
    expect(migration).toContain(
      "submitted_kind = 'privacy'\n       and target_organization is not null",
    );
    expect(migration).toContain(
      "case when submitted_kind = 'privacy' then 15 else 1 end",
    );
  });
});
