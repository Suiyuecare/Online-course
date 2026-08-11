import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountCountDetail,
  captureAccountRead,
} from "@/application/learner-account-page";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("learner account fail-closed reads", () => {
  it("keeps legitimate empty values separate from unavailable reads", async () => {
    await expect(captureAccountRead(Promise.resolve([]))).resolves.toEqual({
      available: true,
      data: [],
    });
    await expect(captureAccountRead(Promise.resolve(null))).resolves.toEqual({
      available: true,
      data: null,
    });
    await expect(
      captureAccountRead(Promise.reject(new Error("offline"))),
    ).resolves.toEqual({
      available: false,
      data: null,
    });
  });

  it("never describes an unavailable count as zero", () => {
    const labels = {
      empty: "目前沒有未讀通知",
      available: (count: number) => `${count} 則未讀`,
    };
    expect(accountCountDetail(null, labels)).toBe("暫時無法讀取");
    expect(accountCountDetail(0, labels)).toBe("目前沒有未讀通知");
    expect(accountCountDetail(3, labels)).toBe("3 則未讀");
  });

  it("blocks the editable form until every profile projection is trustworthy", () => {
    const page = source("src/app/learner/account/page.tsx");
    expect(page).toContain("const editorAvailable =");
    expect(page).toContain("profileState.available &&");
    expect(page).toContain("learnerRowsState.available &&");
    expect(page).toContain("instructorState.available");
    expect(page).toContain("data ? (");
    expect(page).toContain("<ProfessionalProfileEditor initialData={data} />");
    expect(page).toContain("目前無法安全讀取完整個人檔案");
    expect(page).toContain("系統不會用空白內容取代既有資料");
    expect(page).not.toContain(
      "readLearnerCenterRows(supabase).catch(() => [])",
    );
    expect(page).not.toContain("emptyProfessionalProfile(fallbackName)");
    expect(page).not.toContain("const unreadCount = unreadResult.count ?? 0");
  });

  it("treats a confirmed non-instructor as an optional empty state", () => {
    const page = source("src/app/learner/account/page.tsx");
    expect(page).toContain('"authorize_exact_staff_role"');
    expect(page).toContain('p_required_role: "instructor"');
    expect(page).toContain("if (!isInstructor) return null");
    expect(page).toContain("if (error || typeof isInstructor !==");
  });

  it("does not disguise an instructor workspace outage as a role denial", () => {
    const page = source("src/app/instructor/page.tsx");
    expect(page).toContain('"authorize_exact_staff_role"');
    expect(page).toContain("目前無法安全確認講師權限");
    expect(page).toContain("講師資料目前無法讀取");
    expect(page).toContain("if (!isInstructor) redirect");
    expect(page).not.toContain('if (!dashboard) redirect("/staff/security")');
  });
});
