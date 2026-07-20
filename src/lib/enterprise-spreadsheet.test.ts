import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildEnterpriseReportWorkbook,
  createEnterpriseReportBuffer,
  createEnterpriseRosterTemplateBuffer,
  ENTERPRISE_ROSTER_MAX_ROWS,
  parseEnterpriseRosterWorkbook,
  type EnterpriseReportInput,
} from "./enterprise-spreadsheet";

async function workbookBuffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function rosterWorkbook(rows: CellValueRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("名冊");
  sheet.addRow(["Email", "姓名", "員工編號", "部門"]);
  for (const row of rows) sheet.addRow(row);
  return workbook;
}

type CellValueRow = Parameters<ExcelJS.Worksheet["addRow"]>[0];

const reportInput: EnterpriseReportInput = {
  organization: { name: "歲悅測試機構", taxId: "12345678" },
  generatedAt: new Date("2026-07-20T01:02:03.000Z"),
  filters: { department: "照護部" },
  trainingSummaries: [
    {
      courseTitle: "失智照護入門",
      delivery: "recorded",
      purchasedSeats: 10,
      availableSeats: 3,
      assignedSeats: 7,
      consumedSeats: 5,
      completedLearners: 4,
      completionRate: 0.4,
    },
  ],
  employeeOutcomes: [
    {
      name: "=2+2",
      email: "learner@example.com",
      employeeNumber: "0012",
      department: "照護部",
      courseTitle: "失智照護入門",
      delivery: "recorded",
      assignedAt: "2026-07-01T00:00:00.000Z",
      deadline: "2026-12-31T00:00:00.000Z",
      progressRate: 0.8,
      quizStatus: "completed",
      satisfactionStatus: "pending",
      certificateStatus: "pending",
      completionStatus: "in_progress",
    },
  ],
  liveAttendances: [
    {
      name: "王小明",
      email: "live@example.com",
      employeeNumber: "0023",
      department: "照護部",
      courseTitle: "直播照護實務",
      liveSessionTitle: "八月場",
      startsAt: "2026-08-01T01:00:00.000Z",
      checkedInAt: "2026-08-01T00:55:00.000Z",
      checkedOutAt: "2026-08-01T03:00:00.000Z",
      cameraRate: 0.8,
      attendanceStatus: "qualified",
    },
  ],
  seatLedgerEvents: [
    {
      occurredAt: "2026-07-20T01:00:00.000Z",
      courseTitle: "失智照護入門",
      batchLabel: "2026-07-企業購買",
      eventType: "assigned",
      quantityDelta: -1,
      employeeName: "王小明",
      reason: "企業管理者指派",
    },
    {
      occurredAt: "2026-07-20T02:00:00.000Z",
      courseTitle: "失智照護入門",
      batchLabel: "2026-07-企業購買",
      eventType: "correction",
      quantityDelta: 2,
      reason: "管理員核對後補登",
    },
  ],
};

describe("enterprise roster spreadsheet", () => {
  it("normalizes valid rows and ignores blank rows", async () => {
    const workbook = rosterWorkbook([
      [" Learner@Example.com ", "王小明", "0012", "照護部"],
      [null, null, null, null],
    ]);
    const result = await parseEnterpriseRosterWorkbook(
      await workbookBuffer(workbook),
    );
    expect(result.valid).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        email: "learner@example.com",
        name: "王小明",
        employeeNumber: "0012",
        department: "照護部",
      },
    ]);
  });

  it("reports every row error, duplicates, and unsafe formula cells", async () => {
    const workbook = rosterWorkbook([
      ["same@example.com", "王小明", "001", "照護部"],
      ["SAME@example.com", "李小美", "002", "行政部"],
      ["not-an-email", "=HYPERLINK(\"https://bad.example\")", "003", "行政部"],
      [{ formula: "2+2", result: "formula@example.com" }, "林大同", "004", "行政部"],
      [null, "沒有信箱", "005", "照護部"],
    ]);
    const result = await parseEnterpriseRosterWorkbook(
      await workbookBuffer(workbook),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.filter((error) => error.code === "duplicate_email")).toHaveLength(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_email", rowNumber: 4 }),
        expect.objectContaining({ code: "unsafe_formula", rowNumber: 4, field: "name" }),
        expect.objectContaining({ code: "unsafe_formula", rowNumber: 5, field: "email" }),
        expect.objectContaining({ code: "missing_email", rowNumber: 6 }),
      ]),
    );
  });

  it("rejects rosters over the 1000-row limit", async () => {
    const rows = Array.from({ length: ENTERPRISE_ROSTER_MAX_ROWS + 1 }, (_, index) => [
      `learner-${index}@example.com`,
      `學員 ${index}`,
    ]);
    const result = await parseEnterpriseRosterWorkbook(
      await workbookBuffer(rosterWorkbook(rows)),
    );
    expect(result.totalRows).toBe(1001);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "row_limit_exceeded" }),
    );
  });

  it("rejects a sparse worksheet with an extreme row dimension before scanning it", async () => {
    const workbook = rosterWorkbook([["first@example.com", "第一位"]]);
    workbook.getWorksheet(1)!.getRow(500_000).getCell(1).value =
      "last@example.com";
    const result = await parseEnterpriseRosterWorkbook(
      await workbookBuffer(workbook),
    );
    expect(result.valid).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "row_limit_exceeded" }),
    );
  });

  it("creates a downloadable template accepted by the parser", async () => {
    const buffer = await createEnterpriseRosterTemplateBuffer();
    const result = await parseEnterpriseRosterWorkbook(buffer);
    expect(result).toMatchObject({
      valid: true,
      worksheetName: "員工名冊匯入",
      headerRowNumber: 1,
      totalRows: 0,
      rows: [],
    });
  });
});

describe("enterprise report spreadsheet", () => {
  it("creates the four required, formatted worksheets without sensitive columns", () => {
    const workbook = buildEnterpriseReportWorkbook(reportInput);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "培訓摘要",
      "員工成果",
      "直播出席",
      "名額異動",
    ]);

    const outcome = workbook.getWorksheet("員工成果");
    expect(outcome).toBeDefined();
    expect(outcome?.getRow(5).values).toEqual([
      ,
      "姓名",
      "Email",
      "員工編號",
      "部門",
      "課程",
      "類型",
      "直播場次",
      "指派日期",
      "完成期限",
      "觀看進度",
      "測驗",
      "滿意度",
      "證明",
      "完成狀態",
    ]);
    expect(
      (outcome?.getRow(5).values as ExcelJS.CellValue[]).join("|"),
    ).not.toMatch(/身分證|長照字號|測驗答案|原始事件/);
    expect(outcome?.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(outcome?.autoFilter).toBeTruthy();
    expect(outcome?.getColumn("assignedAt").numFmt).toBe("yyyy-mm-dd");
    expect(outcome?.getColumn("progress").numFmt).toBe("0.0%");
    expect(outcome?.getCell("A6").value).toBe("'=2+2");
    expect(outcome?.getCell("H6").value).toBeInstanceOf(Date);
    expect(outcome?.getCell("J6").value).toBe(0.8);
  });

  it("serializes report values as native dates and percentages", async () => {
    const buffer = await createEnterpriseReportBuffer(reportInput);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(Uint8Array.from(buffer).buffer);
    const live = loaded.getWorksheet("直播出席");
    expect(live?.getCell("G6").value).toBeInstanceOf(Date);
    expect(live?.getCell("J6").value).toBe(0.8);
    expect(live?.getColumn(10).numFmt).toBe("0.0%");
    expect(loaded.getWorksheet("名額異動")?.getCell("E6").value).toBe(-1);
    expect(loaded.getWorksheet("名額異動")?.getCell("D7").value).toBe("人工更正");
    expect(loaded.getWorksheet("名額異動")?.getCell("E7").value).toBe(2);
  });
});
