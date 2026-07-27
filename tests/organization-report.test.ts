import { describe, expect, it } from "vitest";
import {
  buildOrganizationTrainingWorkbook,
  organizationTrainingReport,
} from "@/infrastructure/exports/organization-training-workbook";
import { Workbook } from "exceljs";

const report = organizationTrainingReport.parse({
  generatedAt: "2026-07-24T00:00:00.000Z",
  organizationId: "00000000-0000-4000-8000-000000000001",
  trainingSummary: [
    {
      course_title: "網路課程",
      course_version: 1,
      assigned_count: 2,
      completed_count: 1,
      credited_count: 0,
      funded_points: 1200,
    },
  ],
  learnerResults: [
    {
      assignmentId: "00000000-0000-4000-8000-000000000002",
      employeeNumber: '=HYPERLINK("https://invalid")',
      department: "照護部",
      courseTitle: "網路課程",
      courseVersion: 1,
      assignmentStatus: "consumed",
      enrollmentStatus: "completed",
      validMinutes: 60,
      quizScore: 90,
      quizPassed: true,
      certificateStatus: "active",
      completedAt: "2026-07-24T01:00:00.000Z",
    },
  ],
  liveAttendance: [],
  pointLedger: [],
});

describe("organization training workbook", () => {
  it("creates all four scoped report sheets plus a status legend", async () => {
    const bytes = await buildOrganizationTrainingWorkbook(report);
    const workbook = new Workbook();
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "培訓摘要",
      "員工成果",
      "直播出席",
      "點數異動",
      "狀態圖例",
    ]);
    expect(workbook.getWorksheet("培訓摘要")?.getCell("G2").numFmt).toBe(
      "0.0%",
    );
  });

  it("neutralizes formula-like employee fields and keeps dates native", async () => {
    const bytes = await buildOrganizationTrainingWorkbook(report);
    const workbook = new Workbook();
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("員工成果")!;
    expect(sheet.getCell("A2").value).toBe('\'=HYPERLINK("https://invalid")');
    expect(sheet.getCell("K2").value).toBeInstanceOf(Date);
  });
});
