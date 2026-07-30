import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("staff demonstration", () => {
  const page = source("src/app/demo/staff/page.tsx");
  const client = source("src/app/demo/staff/staff-demo.tsx");

  it("clearly separates synthetic demonstration data from production", () => {
    expect(page).toContain("操作示範環境");
    expect(page).toContain("合成資料");
    expect(page).toContain("不會發布課程、確認付款或修改正式紀錄");
    expect(page).toContain("index: false");
  });

  it("covers the four essential administrator stories", () => {
    for (const label of ["課程製作", "匯款審核", "出席異常", "稽核紀錄"]) {
      expect(client).toContain(label);
    }
    expect(client).toContain("付款結果頁不會自行開課");
    expect(client).toContain("只新增更正，不覆寫原始事件");
  });

  it("provides accessible tab and live-result semantics", () => {
    expect(client).toContain('role="tablist"');
    expect(client).toContain('role="tabpanel"');
    expect(client).toContain('aria-live="polite"');
    expect(client).toContain('role="progressbar"');
  });
});
