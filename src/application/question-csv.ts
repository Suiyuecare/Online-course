export type QuestionImportRow = {
  prompt: string;
  topic: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

export type QuestionImportError = {
  row: number;
  message: string;
};

export type QuestionImportPreview = {
  questions: QuestionImportRow[];
  errors: QuestionImportError[];
  sanitizedCells: number;
};

export const questionCsvHeaders = [
  "題目",
  "主題",
  "選項1",
  "選項2",
  "選項3",
  "選項4",
  "正確答案",
  "答案說明",
] as const;

const maximumRows = 200;
const maximumBytes = 1_000_000;
const formulaPrefix = /^[\t\r ]*[=+\-@]/;

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV_QUOTE_NOT_CLOSED");
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function safeSpreadsheetText(value: string) {
  const trimmed = value.trim();
  return formulaPrefix.test(trimmed) ? `'${trimmed}` : trimmed;
}

function parseCorrectIndex(value: string) {
  const normalized = value.trim().toUpperCase();
  if (/^[1-4]$/.test(normalized)) return Number(normalized) - 1;
  if (/^[A-D]$/.test(normalized)) return normalized.charCodeAt(0) - 65;
  return null;
}

function validateLength(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
  errors: string[],
) {
  if (value.length < minimum || value.length > maximum) {
    errors.push(`${label}需為 ${minimum}–${maximum} 個字`);
  }
}

export function parseQuestionCsv(input: string): QuestionImportPreview {
  if (new TextEncoder().encode(input).byteLength > maximumBytes) {
    return {
      questions: [],
      errors: [{ row: 0, message: "CSV 不可超過 1 MB。" }],
      sanitizedCells: 0,
    };
  }

  let rows: string[][];
  try {
    rows = parseCsvRows(input.replace(/^\uFEFF/, ""));
  } catch {
    return {
      questions: [],
      errors: [{ row: 0, message: "CSV 引號沒有正確結束。" }],
      sanitizedCells: 0,
    };
  }

  if (rows.length === 0) {
    return {
      questions: [],
      errors: [{ row: 0, message: "請貼上或選擇 CSV 內容。" }],
      sanitizedCells: 0,
    };
  }

  const header = rows[0].map((value) => value.trim());
  if (
    header.length !== questionCsvHeaders.length ||
    questionCsvHeaders.some((expected, index) => header[index] !== expected)
  ) {
    return {
      questions: [],
      errors: [
        {
          row: 1,
          message: `標題列必須依序為：${questionCsvHeaders.join("、")}。`,
        },
      ],
      sanitizedCells: 0,
    };
  }

  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim().length > 0));
  if (dataRows.length > maximumRows) {
    return {
      questions: [],
      errors: [{ row: 0, message: `一次最多匯入 ${maximumRows} 題。` }],
      sanitizedCells: 0,
    };
  }

  const questions: QuestionImportRow[] = [];
  const errors: QuestionImportError[] = [];
  let sanitizedCells = 0;

  dataRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    if (rawRow.length !== questionCsvHeaders.length) {
      errors.push({
        row: rowNumber,
        message: `欄位數量應為 ${questionCsvHeaders.length} 欄，目前為 ${rawRow.length} 欄。`,
      });
      return;
    }

    const values = rawRow.map((value) => {
      const safe = safeSpreadsheetText(value);
      if (safe !== value.trim()) sanitizedCells += 1;
      return safe;
    });
    const rowErrors: string[] = [];
    validateLength(values[0], 5, 2000, "題目", rowErrors);
    validateLength(values[1], 2, 200, "主題", rowErrors);
    for (let option = 2; option <= 5; option += 1) {
      validateLength(values[option], 1, 1000, `選項 ${option - 1}`, rowErrors);
    }
    validateLength(values[7], 5, 4000, "答案說明", rowErrors);
    const answer = parseCorrectIndex(values[6]);
    if (answer === null) {
      rowErrors.push("正確答案請填 1–4 或 A–D");
    }

    if (rowErrors.length > 0 || answer === null) {
      errors.push({ row: rowNumber, message: rowErrors.join("；") });
      return;
    }

    questions.push({
      prompt: values[0],
      topic: values[1],
      options: [values[2], values[3], values[4], values[5]],
      correctIndex: answer,
      explanation: values[7],
    });
  });

  if (dataRows.length === 0) {
    errors.push({ row: 0, message: "CSV 內至少需要一題。" });
  }

  return { questions, errors, sanitizedCells };
}

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function questionCsvTemplate() {
  return [
    questionCsvHeaders.map(quoteCsv).join(","),
    [
      "範例：失智症患者出現重複提問時，較合適的回應是？",
      "失智照護溝通",
      "責備他不專心",
      "冷靜回應並提供環境提示",
      "完全不理會",
      "立即限制活動",
      "2",
      "先回應情緒與需求，再運用時鐘、圖卡等環境提示，可以降低焦慮。",
    ]
      .map(quoteCsv)
      .join(","),
  ].join("\r\n");
}
