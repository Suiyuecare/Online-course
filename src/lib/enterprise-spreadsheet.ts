import ExcelJS, { type CellValue } from "exceljs";

export const ENTERPRISE_ROSTER_MAX_ROWS = 1000;
const ENTERPRISE_XLSX_MAX_ENTRIES = 256;
const ENTERPRISE_XLSX_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const ENTERPRISE_XLSX_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const ENTERPRISE_XLSX_MAX_COMPRESSION_RATIO = 200;

export type EnterpriseRosterField =
  | "email"
  | "name"
  | "employeeNumber"
  | "department";

export type EnterpriseRosterErrorCode =
  | "missing_worksheet"
  | "missing_header"
  | "duplicate_header"
  | "row_limit_exceeded"
  | "missing_email"
  | "invalid_email"
  | "duplicate_email"
  | "unsafe_formula"
  | "text_too_long";

export interface EnterpriseRosterValidationError {
  code: EnterpriseRosterErrorCode;
  message: string;
  rowNumber?: number;
  field?: EnterpriseRosterField;
  value?: string;
}

export interface EnterpriseRosterRow {
  rowNumber: number;
  email: string;
  name?: string;
  employeeNumber?: string;
  department?: string;
}

export interface EnterpriseRosterParseResult {
  valid: boolean;
  worksheetName?: string;
  headerRowNumber?: number;
  totalRows: number;
  rows: EnterpriseRosterRow[];
  errors: EnterpriseRosterValidationError[];
}

export type EnterpriseCourseDelivery = "recorded" | "live";
export type EnterpriseCompletionStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "expired";
export type EnterpriseProgressStatus = "pending" | "completed" | "not_required";
export type EnterpriseAttendanceStatus =
  | "not_started"
  | "pending_review"
  | "qualified"
  | "disqualified";
export type EnterpriseSeatEventType =
  | "available"
  | "assigned"
  | "consumed"
  | "released"
  | "expired"
  | "refunded"
  | "correction";

export interface EnterpriseReportOrganization {
  name: string;
  taxId?: string;
}

export interface EnterpriseReportFilters {
  courseTitle?: string;
  liveSessionTitle?: string;
  department?: string;
  completionStatus?: EnterpriseCompletionStatus;
}

export interface EnterpriseTrainingSummaryRow {
  courseTitle: string;
  delivery: EnterpriseCourseDelivery;
  liveSessionTitle?: string;
  purchasedSeats: number;
  availableSeats: number;
  assignedSeats: number;
  consumedSeats: number;
  completedLearners: number;
  completionRate: number;
}

export interface EnterpriseEmployeeOutcomeRow {
  name?: string;
  email: string;
  employeeNumber?: string;
  department?: string;
  courseTitle: string;
  delivery: EnterpriseCourseDelivery;
  liveSessionTitle?: string;
  assignedAt: Date | string;
  deadline?: Date | string;
  progressRate: number;
  quizStatus: EnterpriseProgressStatus;
  satisfactionStatus: EnterpriseProgressStatus;
  certificateStatus: EnterpriseProgressStatus;
  completionStatus: EnterpriseCompletionStatus;
}

export interface EnterpriseLiveAttendanceRow {
  name?: string;
  email: string;
  employeeNumber?: string;
  department?: string;
  courseTitle: string;
  liveSessionTitle: string;
  startsAt: Date | string;
  checkedInAt?: Date | string;
  checkedOutAt?: Date | string;
  cameraRate: number;
  attendanceStatus: EnterpriseAttendanceStatus;
}

export interface EnterpriseSeatLedgerRow {
  occurredAt: Date | string;
  courseTitle: string;
  batchLabel?: string;
  eventType: EnterpriseSeatEventType;
  quantityDelta: number;
  employeeName?: string;
  liveSessionTitle?: string;
  reason?: string;
}

export interface EnterpriseReportInput {
  organization: EnterpriseReportOrganization;
  generatedAt?: Date;
  filters?: EnterpriseReportFilters;
  trainingSummaries: EnterpriseTrainingSummaryRow[];
  employeeOutcomes: EnterpriseEmployeeOutcomeRow[];
  liveAttendances: EnterpriseLiveAttendanceRow[];
  seatLedgerEvents: EnterpriseSeatLedgerRow[];
}

type ReportValue = CellValue;
type ReportRow = Record<string, ReportValue>;

interface ReportColumn {
  key: string;
  header: string;
  width: number;
  numberFormat?: string;
}

const HEADER_ALIASES: Record<EnterpriseRosterField, string[]> = {
  email: ["email", "e-mail", "電子郵件", "電子信箱", "信箱"],
  name: ["姓名", "名字", "name"],
  employeeNumber: ["員工編號", "員編", "employee id", "employee number"],
  department: ["部門", "單位", "department"],
};

const ROSTER_FIELDS = Object.keys(HEADER_ALIASES) as EnterpriseRosterField[];
const EMAIL_MAX_LENGTH = 254;
const FIELD_MAX_LENGTH: Record<EnterpriseRosterField, number> = {
  email: EMAIL_MAX_LENGTH,
  name: 100,
  employeeNumber: 60,
  department: 100,
};
const UNSAFE_FORMULA_PREFIX = /^\s*[=+\-@]/;
const UNSAFE_CONTROL_PREFIX = /^[\t\r\n]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAND_ORANGE = "FFEA880C";
const BRAND_DARK_ORANGE = "FFB45309";
const BRAND_CREAM = "FFFFF8ED";
const BORDER_COLOR = "FFF1D4B3";

const deliveryLabels: Record<EnterpriseCourseDelivery, string> = {
  recorded: "錄播課",
  live: "直播課",
};

const progressLabels: Record<EnterpriseProgressStatus, string> = {
  pending: "未完成",
  completed: "已完成",
  not_required: "不適用",
};

const completionLabels: Record<EnterpriseCompletionStatus, string> = {
  not_started: "未開始",
  in_progress: "進行中",
  completed: "已完成",
  expired: "已逾期",
};

const attendanceLabels: Record<EnterpriseAttendanceStatus, string> = {
  not_started: "未開始",
  pending_review: "待審核",
  qualified: "合格",
  disqualified: "不合格",
};

const seatEventLabels: Record<EnterpriseSeatEventType, string> = {
  available: "新增可用",
  assigned: "已指派",
  consumed: "已使用",
  released: "已釋出",
  expired: "已到期",
  refunded: "已退費",
  correction: "人工更正",
};

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function canonicalHeader(value: string): EnterpriseRosterField | undefined {
  const normalized = normalizeHeader(value);
  return ROSTER_FIELDS.find((field) =>
    HEADER_ALIASES[field].some(
      (alias) => normalizeHeader(alias) === normalized,
    ),
  );
}

function isFormulaCell(value: CellValue): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      ("formula" in value || "sharedFormula" in value),
  );
}

function cellText(value: CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value)
    return value.richText
      .map((part) => part.text)
      .join("")
      .trim();
  if ("text" in value) return value.text.trim();
  if ("error" in value) return value.error;
  return "";
}

function isUnsafeSpreadsheetText(value: string) {
  return UNSAFE_FORMULA_PREFIX.test(value) || UNSAFE_CONTROL_PREFIX.test(value);
}

/**
 * Keeps untrusted labels as text when Excel opens an exported workbook.
 */
export function safeEnterpriseSpreadsheetText(value: string) {
  return isUnsafeSpreadsheetText(value) ? `'${value}` : value;
}

function arrayBufferFromInput(input: Buffer | Uint8Array | ArrayBuffer) {
  if (input instanceof ArrayBuffer) return input;
  const copy = Uint8Array.from(input);
  return copy.buffer;
}

function assertXlsxArchiveBudget(input: ArrayBuffer) {
  const view = new DataView(input);
  const minimumEocdOffset = Math.max(0, input.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = input.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("INVALID_XLSX_ARCHIVE");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (
    entryCount < 1 ||
    entryCount > ENTERPRISE_XLSX_MAX_ENTRIES ||
    centralDirectoryOffset + centralDirectorySize > input.byteLength
  )
    throw new Error("XLSX_ARCHIVE_LIMIT_EXCEEDED");
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > input.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error("INVALID_XLSX_ARCHIVE");
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (
      flags & 0x1 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > ENTERPRISE_XLSX_MAX_ENTRY_BYTES ||
      (uncompressedSize > 1_048_576 &&
        uncompressedSize >
          Math.max(1, compressedSize) * ENTERPRISE_XLSX_MAX_COMPRESSION_RATIO)
    )
      throw new Error("XLSX_ARCHIVE_LIMIT_EXCEEDED");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > ENTERPRISE_XLSX_MAX_UNCOMPRESSED_BYTES)
      throw new Error("XLSX_ARCHIVE_LIMIT_EXCEEDED");
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (offset > centralDirectoryOffset + centralDirectorySize)
    throw new Error("INVALID_XLSX_ARCHIVE");
}

function findRosterHeader(workbook: ExcelJS.Workbook) {
  for (const worksheet of workbook.worksheets) {
    const lastRow = Math.min(worksheet.rowCount, 20);
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      let hasEmailHeader = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (canonicalHeader(cellText(cell.value)) === "email")
          hasEmailHeader = true;
      });
      if (hasEmailHeader) return { worksheet, rowNumber };
    }
  }
  return undefined;
}

function fieldLabel(field: EnterpriseRosterField) {
  return {
    email: "Email",
    name: "姓名",
    employeeNumber: "員工編號",
    department: "部門",
  }[field];
}

export async function parseEnterpriseRosterWorkbook(
  input: Buffer | Uint8Array | ArrayBuffer,
): Promise<EnterpriseRosterParseResult> {
  const archive = arrayBufferFromInput(input);
  assertXlsxArchiveBudget(archive);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(archive);
  const errors: EnterpriseRosterValidationError[] = [];
  const located = findRosterHeader(workbook);
  if (!workbook.worksheets.length) {
    return {
      valid: false,
      totalRows: 0,
      rows: [],
      errors: [
        { code: "missing_worksheet", message: "Excel 檔案沒有可讀取的工作表。" },
      ],
    };
  }
  if (!located) {
    return {
      valid: false,
      worksheetName: workbook.worksheets[0].name,
      totalRows: 0,
      rows: [],
      errors: [
        {
          code: "missing_header",
          field: "email",
          message: "找不到 Email 欄位，請使用歲悅學苑提供的匯入範本。",
        },
      ],
    };
  }

  const { worksheet, rowNumber: headerRowNumber } = located;
  if (worksheet.rowCount > headerRowNumber + ENTERPRISE_ROSTER_MAX_ROWS + 100)
    return {
      valid: false,
      worksheetName: worksheet.name,
      headerRowNumber,
      totalRows: Math.max(0, worksheet.rowCount - headerRowNumber),
      rows: [],
      errors: [
        {
          code: "row_limit_exceeded",
          message: `一次最多匯入 ${ENTERPRISE_ROSTER_MAX_ROWS} 筆；工作表範圍異常，請移除多餘空白列後重試。`,
        },
      ],
    };
  const headerColumns = new Map<EnterpriseRosterField, number>();
  worksheet.getRow(headerRowNumber).eachCell({ includeEmpty: false }, (cell) => {
    const field = canonicalHeader(cellText(cell.value));
    if (!field) return;
    if (headerColumns.has(field)) {
      errors.push({
        code: "duplicate_header",
        rowNumber: headerRowNumber,
        field,
        value: cellText(cell.value),
        message: `${fieldLabel(field)} 欄位重複，請只保留一欄。`,
      });
      return;
    }
    headerColumns.set(field, cell.fullAddress.col);
  });

  if (!headerColumns.has("email")) {
    errors.push({
      code: "missing_header",
      rowNumber: headerRowNumber,
      field: "email",
      message: "Email 欄位為必填。",
    });
  }

  const rows: EnterpriseRosterRow[] = [];
  const errorsByEmail = new Map<string, EnterpriseRosterRow[]>();
  let totalRows = 0;
  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    const rawValues = new Map<EnterpriseRosterField, CellValue>();
    for (const [field, columnNumber] of headerColumns)
      rawValues.set(field, row.getCell(columnNumber).value);
    if (
      [...rawValues.values()].every(
        (value) => !isFormulaCell(value) && cellText(value) === "",
      )
    )
      continue;

    totalRows += 1;
    if (totalRows > ENTERPRISE_ROSTER_MAX_ROWS) {
      errors.push({
        code: "row_limit_exceeded",
        message: `一次最多匯入 ${ENTERPRISE_ROSTER_MAX_ROWS} 筆。`,
      });
      break;
    }
    const parsedValues: Partial<Record<EnterpriseRosterField, string>> = {};
    for (const field of ROSTER_FIELDS) {
      const value = rawValues.get(field);
      if (value == null) continue;
      const text = cellText(value);
      if (isFormulaCell(value) || isUnsafeSpreadsheetText(text)) {
        errors.push({
          code: "unsafe_formula",
          rowNumber,
          field,
          value: text,
          message: `${fieldLabel(field)} 不得包含公式或以 =、+、-、@ 開頭。`,
        });
        continue;
      }
      const maxLength = FIELD_MAX_LENGTH[field];
      if (text.length > maxLength) {
        errors.push({
          code: "text_too_long",
          rowNumber,
          field,
          value: text.slice(0, 80),
          message: `${fieldLabel(field)} 長度不得超過 ${maxLength} 個字元。`,
        });
        continue;
      }
      if (text) parsedValues[field] = text;
    }

    const normalizedEmail = parsedValues.email?.toLocaleLowerCase("en-US") ?? "";
    if (!normalizedEmail) {
      if (!errors.some((error) => error.rowNumber === rowNumber && error.field === "email"))
        errors.push({
          code: "missing_email",
          rowNumber,
          field: "email",
          message: "Email 為必填。",
        });
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      errors.push({
        code: "invalid_email",
        rowNumber,
        field: "email",
        value: normalizedEmail,
        message: "Email 格式不正確。",
      });
    }

    const parsedRow: EnterpriseRosterRow = {
      rowNumber,
      email: normalizedEmail,
      ...(parsedValues.name ? { name: parsedValues.name } : {}),
      ...(parsedValues.employeeNumber
        ? { employeeNumber: parsedValues.employeeNumber }
        : {}),
      ...(parsedValues.department ? { department: parsedValues.department } : {}),
    };
    rows.push(parsedRow);
    if (normalizedEmail) {
      const duplicateRows = errorsByEmail.get(normalizedEmail) ?? [];
      duplicateRows.push(parsedRow);
      errorsByEmail.set(normalizedEmail, duplicateRows);
    }
  }

  for (const [email, duplicateRows] of errorsByEmail) {
    if (duplicateRows.length < 2) continue;
    for (const duplicateRow of duplicateRows)
      errors.push({
        code: "duplicate_email",
        rowNumber: duplicateRow.rowNumber,
        field: "email",
        value: email,
        message: `Email ${email} 在檔案中重複。`,
      });
  }

  return {
    valid: errors.length === 0,
    worksheetName: worksheet.name,
    headerRowNumber,
    totalRows,
    rows,
    errors,
  };
}

function applyRosterHeaderStyle(worksheet: ExcelJS.Worksheet) {
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_DARK_ORANGE },
  };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 28;
  worksheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  worksheet.autoFilter = "A1:D1";
}

export function buildEnterpriseRosterTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "歲悅學苑";
  workbook.subject = "企業員工名冊匯入範本";
  workbook.created = new Date();
  const roster = workbook.addWorksheet("員工名冊匯入");
  roster.columns = [
    { header: "Email", key: "email", width: 34 },
    { header: "姓名", key: "name", width: 18 },
    { header: "員工編號", key: "employeeNumber", width: 18 },
    { header: "部門", key: "department", width: 22 },
  ];
  applyRosterHeaderStyle(roster);

  const instructions = workbook.addWorksheet("填寫說明");
  instructions.columns = [{ width: 24 }, { width: 72 }];
  instructions.addRows([
    ["欄位", "說明"],
    ["Email", "必填；作為歲悅學苑帳號及邀請通知信箱。"],
    ["姓名", "選填。"],
    ["員工編號", "選填；建議保留前導零並將儲存格格式設為文字。"],
    ["部門", "選填。"],
    ["匯入限制", `每次最多 ${ENTERPRISE_ROSTER_MAX_ROWS} 筆；請勿填入公式。`],
  ]);
  applyRosterHeaderStyle(instructions);
  instructions.autoFilter = undefined;
  return workbook;
}

export async function createEnterpriseRosterTemplateBuffer() {
  const buffer = await buildEnterpriseRosterTemplateWorkbook().xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function toExcelDate(value?: Date | string) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date;
}

function safeText(value?: string) {
  return safeEnterpriseSpreadsheetText(value?.trim() ?? "");
}

function filterDescription(filters?: EnterpriseReportFilters) {
  const parts = [
    filters?.courseTitle && `課程：${safeText(filters.courseTitle)}`,
    filters?.liveSessionTitle && `場次：${safeText(filters.liveSessionTitle)}`,
    filters?.department && `部門：${safeText(filters.department)}`,
    filters?.completionStatus &&
      `完成狀態：${completionLabels[filters.completionStatus]}`,
  ].filter(Boolean);
  return parts.length ? parts.join("｜") : "全部資料";
}

function addReportSheet(
  workbook: ExcelJS.Workbook,
  options: {
    name: string;
    title: string;
    metadata: string;
    legend: string;
    columns: ReportColumn[];
    rows: ReportRow[];
    statusColumnKey?: string;
  },
) {
  const worksheet = workbook.addWorksheet(options.name, {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  worksheet.columns = options.columns.map((column) => ({
    key: column.key,
    width: Math.min(column.width, 42),
  }));

  worksheet.mergeCells(1, 1, 1, options.columns.length);
  worksheet.getCell(1, 1).value = options.title;
  worksheet.getRow(1).height = 32;
  worksheet.getCell(1, 1).font = {
    bold: true,
    size: 16,
    color: { argb: "FF3B2411" },
  };
  worksheet.getCell(1, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_ORANGE },
  };
  worksheet.getCell(1, 1).alignment = { vertical: "middle", horizontal: "left" };

  worksheet.mergeCells(2, 1, 2, options.columns.length);
  worksheet.getCell(2, 1).value = options.metadata;
  worksheet.getCell(2, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_CREAM },
  };
  worksheet.getCell(2, 1).font = { color: { argb: "FF6B3B0D" } };

  worksheet.mergeCells(3, 1, 3, options.columns.length);
  worksheet.getCell(3, 1).value = options.legend;
  worksheet.getCell(3, 1).font = { italic: true, color: { argb: "FF7C4A17" } };
  worksheet.getCell(3, 1).alignment = { wrapText: true, vertical: "middle" };
  worksheet.getRow(3).height = 28;

  const header = worksheet.getRow(5);
  header.values = options.columns.map((column) => column.header);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_DARK_ORANGE },
  };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 30;

  for (const rowData of options.rows) worksheet.addRow(rowData);
  const finalRow = Math.max(5, worksheet.rowCount);
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: finalRow, column: options.columns.length },
  };

  for (const column of options.columns) {
    if (column.numberFormat)
      worksheet.getColumn(column.key).numFmt = column.numberFormat;
    worksheet.getColumn(column.key).alignment = {
      vertical: "top",
      wrapText: true,
    };
  }
  for (let rowNumber = 6; rowNumber <= finalRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.border = { bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
  }
  if (options.statusColumnKey) {
    const statusColumn = worksheet.getColumn(options.statusColumnKey);
    for (let rowNumber = 6; rowNumber <= finalRow; rowNumber += 1) {
      const cell = worksheet.getCell(rowNumber, statusColumn.number);
      const status = String(cell.value ?? "");
      if (["已完成", "合格"].includes(status))
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE7F6EC" },
        };
      if (["已逾期", "不合格"].includes(status))
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFDE8E7" },
        };
      if (["進行中", "待審核"].includes(status))
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" },
        };
    }
  }
  return worksheet;
}

export function buildEnterpriseReportWorkbook(input: EnterpriseReportInput) {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = input.generatedAt ?? new Date();
  workbook.creator = "歲悅學苑";
  workbook.subject = `${input.organization.name}企業培訓報表`;
  workbook.created = generatedAt;
  const metadata = `${safeText(input.organization.name)}${
    input.organization.taxId ? `（統編 ${safeText(input.organization.taxId)}）` : ""
  }｜產生時間：${generatedAt.toISOString()}｜篩選：${filterDescription(input.filters)}`;

  addReportSheet(workbook, {
    name: "培訓摘要",
    title: "歲悅學苑｜企業培訓摘要",
    metadata,
    legend:
      "狀態圖例：可用＝尚未指派｜已指派＝已分配學員｜已使用＝開始觀看或完成直播簽到｜已完成＝達成課程條件",
    columns: [
      { key: "course", header: "課程", width: 32 },
      { key: "delivery", header: "課程類型", width: 14 },
      { key: "session", header: "直播場次", width: 28 },
      { key: "purchased", header: "已購名額", width: 14, numberFormat: "#,##0" },
      { key: "available", header: "可用名額", width: 14, numberFormat: "#,##0" },
      { key: "assigned", header: "已指派", width: 14, numberFormat: "#,##0" },
      { key: "consumed", header: "已使用", width: 14, numberFormat: "#,##0" },
      { key: "completed", header: "已完成", width: 14, numberFormat: "#,##0" },
      { key: "rate", header: "完成率", width: 14, numberFormat: "0.0%" },
    ],
    rows: input.trainingSummaries.map((row) => ({
      course: safeText(row.courseTitle),
      delivery: deliveryLabels[row.delivery],
      session: safeText(row.liveSessionTitle),
      purchased: row.purchasedSeats,
      available: row.availableSeats,
      assigned: row.assignedSeats,
      consumed: row.consumedSeats,
      completed: row.completedLearners,
      rate: row.completionRate,
    })),
  });

  addReportSheet(workbook, {
    name: "員工成果",
    title: "歲悅學苑｜員工學習成果",
    metadata,
    legend: "狀態圖例：未開始｜進行中｜已完成｜已逾期；不包含測驗答案或積分個資。",
    statusColumnKey: "completion",
    columns: [
      { key: "name", header: "姓名", width: 16 },
      { key: "email", header: "Email", width: 30 },
      { key: "employeeNumber", header: "員工編號", width: 18 },
      { key: "department", header: "部門", width: 18 },
      { key: "course", header: "課程", width: 30 },
      { key: "delivery", header: "類型", width: 12 },
      { key: "session", header: "直播場次", width: 26 },
      { key: "assignedAt", header: "指派日期", width: 18, numberFormat: "yyyy-mm-dd" },
      { key: "deadline", header: "完成期限", width: 18, numberFormat: "yyyy-mm-dd" },
      { key: "progress", header: "觀看進度", width: 14, numberFormat: "0.0%" },
      { key: "quiz", header: "測驗", width: 14 },
      { key: "satisfaction", header: "滿意度", width: 14 },
      { key: "certificate", header: "證明", width: 14 },
      { key: "completion", header: "完成狀態", width: 14 },
    ],
    rows: input.employeeOutcomes.map((row) => ({
      name: safeText(row.name),
      email: safeText(row.email),
      employeeNumber: safeText(row.employeeNumber),
      department: safeText(row.department),
      course: safeText(row.courseTitle),
      delivery: deliveryLabels[row.delivery],
      session: safeText(row.liveSessionTitle),
      assignedAt: toExcelDate(row.assignedAt),
      deadline: toExcelDate(row.deadline),
      progress: row.progressRate,
      quiz: progressLabels[row.quizStatus],
      satisfaction: progressLabels[row.satisfactionStatus],
      certificate: progressLabels[row.certificateStatus],
      completion: completionLabels[row.completionStatus],
    })),
  });

  addReportSheet(workbook, {
    name: "直播出席",
    title: "歲悅學苑｜直播出席結果",
    metadata,
    legend: "狀態圖例：未開始｜待審核｜合格｜不合格；僅列摘要，不包含 Zoom 或鏡頭原始事件。",
    statusColumnKey: "attendance",
    columns: [
      { key: "name", header: "姓名", width: 16 },
      { key: "email", header: "Email", width: 30 },
      { key: "employeeNumber", header: "員工編號", width: 18 },
      { key: "department", header: "部門", width: 18 },
      { key: "course", header: "課程", width: 30 },
      { key: "session", header: "直播場次", width: 28 },
      { key: "startsAt", header: "場次時間", width: 22, numberFormat: "yyyy-mm-dd hh:mm" },
      { key: "checkedInAt", header: "簽到時間", width: 22, numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { key: "checkedOutAt", header: "簽退時間", width: 22, numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { key: "cameraRate", header: "有效鏡頭比例", width: 18, numberFormat: "0.0%" },
      { key: "attendance", header: "出席結果", width: 14 },
    ],
    rows: input.liveAttendances.map((row) => ({
      name: safeText(row.name),
      email: safeText(row.email),
      employeeNumber: safeText(row.employeeNumber),
      department: safeText(row.department),
      course: safeText(row.courseTitle),
      session: safeText(row.liveSessionTitle),
      startsAt: toExcelDate(row.startsAt),
      checkedInAt: toExcelDate(row.checkedInAt),
      checkedOutAt: toExcelDate(row.checkedOutAt),
      cameraRate: row.cameraRate,
      attendance: attendanceLabels[row.attendanceStatus],
    })),
  });

  addReportSheet(workbook, {
    name: "名額異動",
    title: "歲悅學苑｜企業名額異動",
    metadata,
    legend: "狀態圖例：新增可用｜已指派｜已使用｜已釋出｜已到期｜已退費｜人工更正。",
    columns: [
      { key: "occurredAt", header: "異動時間", width: 22, numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { key: "course", header: "課程", width: 30 },
      { key: "batch", header: "名額批次", width: 22 },
      { key: "event", header: "異動類型", width: 16 },
      { key: "quantity", header: "名額變動", width: 14, numberFormat: "+#,##0;-#,##0;0" },
      { key: "employee", header: "相關員工", width: 18 },
      { key: "session", header: "直播場次", width: 28 },
      { key: "reason", header: "原因／備註", width: 40 },
    ],
    rows: input.seatLedgerEvents.map((row) => ({
      occurredAt: toExcelDate(row.occurredAt),
      course: safeText(row.courseTitle),
      batch: safeText(row.batchLabel),
      event: seatEventLabels[row.eventType],
      quantity: row.quantityDelta,
      employee: safeText(row.employeeName),
      session: safeText(row.liveSessionTitle),
      reason: safeText(row.reason),
    })),
  });

  return workbook;
}

export async function createEnterpriseReportBuffer(input: EnterpriseReportInput) {
  const buffer = await buildEnterpriseReportWorkbook(input).xlsx.writeBuffer();
  return Buffer.from(buffer);
}
