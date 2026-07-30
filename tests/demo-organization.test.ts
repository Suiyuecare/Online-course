import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  demoCourses,
  demoEmployees,
  demoOrganization,
} from "@/app/demo/organization/data";

describe("organization demo", () => {
  it("uses a balanced synthetic point wallet", () => {
    expect(
      demoOrganization.availablePoints +
        demoOrganization.reservedPoints +
        demoOrganization.consumedPoints,
    ).toBe(demoOrganization.totalPurchasedPoints);
    expect(demoOrganization.expiringPoints).toBe(0);
  });

  it("offers recorded, live and hybrid assignment examples", () => {
    expect(new Set(demoCourses.map((course) => course.delivery))).toEqual(
      new Set(["錄播", "直播", "混合"]),
    );
    expect(demoCourses.every((course) => course.points > 0)).toBe(true);
  });

  it("keeps learner outcomes internally consistent", () => {
    for (const employee of demoEmployees) {
      if (employee.courseStatus === "已完成") {
        expect(employee.progress).toBe(100);
        expect(employee.quizScore).toBeGreaterThanOrEqual(80);
        expect(employee.certificate).toBe("已取得");
      }
    }
  });

  it("labels the page as synthetic and avoids production requests", () => {
    const source = readFileSync(
      "src/app/demo/organization/organization-demo.tsx",
      "utf8",
    );
    expect(source).toContain("本頁使用虛構資料");
    expect(source).toContain("不會扣點、寄信或寫入正式系統");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
