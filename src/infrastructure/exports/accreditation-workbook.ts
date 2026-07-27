import { Workbook } from "exceljs";

export type AccreditationExportRow = {
  realName: string;
  nationalId: string;
  birthDate: string;
  careWorkerId: string;
  personnelCategory: string;
  phone: string;
  serviceUnit: string;
};

export function safeSpreadsheetText(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export async function buildAccreditationWorkbook(input: {
  rows: AccreditationExportRow[];
  courseTitle: string;
  accreditationReference: string;
  templateVersion: string;
}) {
  const workbook = new Workbook();
  workbook.creator = "歲悅學苑";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const sheet = workbook.addWorksheet("積分送審");
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.addRow(["歲悅學苑積分送審資料"]);
  sheet.addRow([
    `課程：${safeSpreadsheetText(input.courseTitle)}`,
    `核定：${safeSpreadsheetText(input.accreditationReference)}`,
  ]);
  sheet.addRow([`模板版本：${safeSpreadsheetText(input.templateVersion)}`]);
  sheet.addRow([
    "姓名",
    "身分證／居留證",
    "出生日期",
    "長照人員認證字號",
    "人員類別",
    "手機",
    "服務單位",
  ]);
  for (const row of input.rows) {
    sheet.addRow(
      [
        row.realName,
        row.nationalId,
        row.birthDate,
        row.careWorkerId,
        row.personnelCategory,
        row.phone,
        row.serviceUnit,
      ].map(safeSpreadsheetText),
    );
  }
  sheet.getRow(1).font = { bold: true, size: 16 };
  sheet.getRow(4).font = { bold: true };
  sheet.columns = [
    { width: 16 },
    { width: 24 },
    { width: 14 },
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 32 },
  ];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
