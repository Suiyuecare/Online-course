import { Workbook, type Worksheet } from "exceljs";
import { z } from "zod";
import { safeSpreadsheetText } from "@/infrastructure/exports/accreditation-workbook";

const summaryRow = z.object({
  course_title: z.string(),
  course_version: z.number().int(),
  assigned_count: z.number().int(),
  completed_count: z.number().int(),
  credited_count: z.number().int(),
  funded_points: z.number(),
});
const learnerRow = z.object({
  assignmentId: z.uuid(),
  employeeNumber: z.string().nullable(),
  department: z.string().nullable(),
  courseTitle: z.string(),
  courseVersion: z.number().int(),
  assignmentStatus: z.string(),
  enrollmentStatus: z.string().nullable(),
  validMinutes: z.coerce.number(),
  quizScore: z.number().nullable(),
  quizPassed: z.boolean(),
  certificateStatus: z.string().nullable(),
  completedAt: z.string().nullable(),
});
const attendanceRow = z.object({
  assignmentId: z.uuid(),
  employeeNumber: z.string().nullable(),
  department: z.string().nullable(),
  courseTitle: z.string(),
  sessionTitle: z.string(),
  startsAt: z.string(),
  presencePercent: z.coerce.number().nullable(),
  cameraPercent: z.coerce.number().nullable(),
  qualified: z.boolean().nullable(),
  settledAt: z.string().nullable(),
});
const ledgerRow = z.object({
  occurredAt: z.string(),
  eventType: z.string(),
  points: z.number(),
  pointLotId: z.uuid(),
  assignmentId: z.uuid().nullable(),
  reason: z.string(),
});

export const organizationTrainingReport = z.object({
  generatedAt: z.string(),
  organizationId: z.uuid(),
  trainingSummary: z.array(summaryRow),
  learnerResults: z.array(learnerRow),
  liveAttendance: z.array(attendanceRow),
  pointLedger: z.array(ledgerRow),
});

function prepareSheet(sheet: Worksheet, widths: number[]) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF9A4D00" },
  };
  sheet.columns = widths.map((width) => ({ width }));
  sheet.autoFilter = {
    from: "A1",
    to: sheet.getCell(1, widths.length).address,
  };
}

function safe(value: string | null) {
  return safeSpreadsheetText(value ?? "");
}

export async function buildOrganizationTrainingWorkbook(
  input: z.infer<typeof organizationTrainingReport>,
) {
  const workbook = new Workbook();
  workbook.creator = "歲悅學苑";
  workbook.created = new Date(input.generatedAt);
  workbook.modified = new Date(input.generatedAt);

  const summary = workbook.addWorksheet("培訓摘要");
  summary.addRow([
    "課程",
    "版本",
    "指派人次",
    "平台完課人次",
    "正式登錄人次",
    "資助點數",
    "完課率",
  ]);
  for (const row of input.trainingSummary) {
    summary.addRow([
      safe(row.course_title),
      row.course_version,
      row.assigned_count,
      row.completed_count,
      row.credited_count,
      row.funded_points,
      row.assigned_count === 0 ? 0 : row.completed_count / row.assigned_count,
    ]);
  }
  summary.getColumn(7).numFmt = "0.0%";
  prepareSheet(summary, [34, 10, 14, 16, 16, 14, 14]);

  const learners = workbook.addWorksheet("員工成果");
  learners.addRow([
    "員工編號",
    "部門",
    "課程",
    "版本",
    "指派狀態",
    "修課狀態",
    "有效分鐘",
    "最高測驗分數",
    "測驗通過",
    "證明狀態",
    "完課時間",
    "Assignment ID",
  ]);
  for (const row of input.learnerResults) {
    learners.addRow([
      safe(row.employeeNumber),
      safe(row.department),
      safe(row.courseTitle),
      row.courseVersion,
      safe(row.assignmentStatus),
      safe(row.enrollmentStatus),
      row.validMinutes,
      row.quizScore,
      row.quizPassed ? "是" : "否",
      safe(row.certificateStatus),
      row.completedAt ? new Date(row.completedAt) : null,
      row.assignmentId,
    ]);
  }
  learners.getColumn(7).numFmt = "0.00";
  learners.getColumn(11).numFmt = "yyyy-mm-dd hh:mm";
  prepareSheet(learners, [18, 18, 34, 10, 15, 15, 14, 16, 12, 15, 20, 38]);

  const attendance = workbook.addWorksheet("直播出席");
  attendance.addRow([
    "員工編號",
    "部門",
    "課程",
    "場次",
    "開始時間",
    "有效在線比例",
    "鏡頭證據比例",
    "合格",
    "結算時間",
    "Assignment ID",
  ]);
  for (const row of input.liveAttendance) {
    attendance.addRow([
      safe(row.employeeNumber),
      safe(row.department),
      safe(row.courseTitle),
      safe(row.sessionTitle),
      new Date(row.startsAt),
      row.presencePercent === null ? null : row.presencePercent / 100,
      row.cameraPercent === null ? null : row.cameraPercent / 100,
      row.qualified === null ? "待結算" : row.qualified ? "是" : "否",
      row.settledAt ? new Date(row.settledAt) : null,
      row.assignmentId,
    ]);
  }
  attendance.getColumn(5).numFmt = "yyyy-mm-dd hh:mm";
  attendance.getColumn(6).numFmt = "0.0%";
  attendance.getColumn(7).numFmt = "0.0%";
  attendance.getColumn(9).numFmt = "yyyy-mm-dd hh:mm";
  prepareSheet(attendance, [18, 18, 34, 30, 20, 16, 16, 12, 20, 38]);

  const ledger = workbook.addWorksheet("點數異動");
  ledger.addRow([
    "發生時間",
    "事件",
    "點數",
    "Point lot ID",
    "Assignment ID",
    "理由",
  ]);
  for (const row of input.pointLedger) {
    ledger.addRow([
      new Date(row.occurredAt),
      safe(row.eventType),
      row.points,
      row.pointLotId,
      row.assignmentId,
      safe(row.reason),
    ]);
  }
  ledger.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
  prepareSheet(ledger, [20, 22, 14, 38, 38, 44]);

  const legend = workbook.addWorksheet("狀態圖例");
  legend.addRow(["代碼", "說明"]);
  [
    ["reserved", "已保留點數，尚未使用"],
    ["active", "已選場或已開放，但尚未消耗"],
    ["consumed", "已開始有效學習或進入直播截止"],
    ["completed", "已達平台完課條件"],
    ["credited", "認可單位已確認正式積分登錄"],
    ["needs_correction", "認可單位要求補正"],
    ["refunded", "已依權威退款流程返還"],
  ].forEach((row) => legend.addRow(row.map(safeSpreadsheetText)));
  prepareSheet(legend, [24, 52]);

  const workbookBytes = await workbook.xlsx.writeBuffer();
  const responseBytes = Buffer.alloc(workbookBytes.byteLength);
  Buffer.from(workbookBytes).copy(responseBytes);
  return responseBytes;
}
