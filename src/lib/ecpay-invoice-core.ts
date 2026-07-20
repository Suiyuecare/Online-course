import {
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";

const BUSINESS_NUMBER_WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;
const FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const ALLOWANCE_CALLBACK_FIELDS = [
  "IA_Allow_No",
  "IA_Date",
  "IA_Invoice_No",
  "IIS_Remain_Allowance_Amt",
  "RtnCode",
  "RtnMsg",
] as const;

function legacyEcpayUrlEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%2D/gi, "-")
    .replace(/%5F/gi, "_")
    .replace(/%2E/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2A/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .toLowerCase();
}

function assertAesMaterial(value: string, label: string) {
  if (Buffer.byteLength(value, "utf8") !== 16)
    throw new Error(`${label}_MUST_BE_16_BYTES`);
  return Buffer.from(value, "utf8");
}

/** ECPay MIG 4.0: URL encode JSON, then AES-128-CBC with PKCS7 padding. */
export function encryptEcpayInvoiceData(
  payload: unknown,
  hashKey: string,
  hashIv: string,
) {
  const key = assertAesMaterial(hashKey, "ECPAY_INVOICE_HASH_KEY");
  const iv = assertAesMaterial(hashIv, "ECPAY_INVOICE_HASH_IV");
  const encoded = encodeURIComponent(JSON.stringify(payload));
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return cipher.update(encoded, "utf8", "base64") + cipher.final("base64");
}

/** Reverse ECPay MIG 4.0 encryption and parse the decrypted JSON payload. */
export function decryptEcpayInvoiceData<T = unknown>(
  encrypted: string,
  hashKey: string,
  hashIv: string,
) {
  const key = assertAesMaterial(hashKey, "ECPAY_INVOICE_HASH_KEY");
  const iv = assertAesMaterial(hashIv, "ECPAY_INVOICE_HASH_IV");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  const encoded =
    decipher.update(encrypted, "base64", "utf8") + decipher.final("utf8");
  return JSON.parse(decodeURIComponent(encoded)) as T;
}

export function invoiceTimestamp(date = new Date()) {
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("INVALID_TIMESTAMP");
  return Math.floor(milliseconds / 1_000);
}

/**
 * MIG 4.0 AllowanceByCollegiate ReturnURL uses the legacy invoice MD5
 * checksum, not AioCheckOut's SHA-256 CheckMacValue.
 */
export function createInvoiceAllowanceCallbackCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
) {
  const fields = ALLOWANCE_CALLBACK_FIELDS.map(
    (key) => `${key}=${params[key] ?? ""}`,
  );
  const source = `HashKey=${hashKey}&${fields.join("&")}&HashIV=${hashIv}`;
  return createHash("md5")
    .update(legacyEcpayUrlEncode(source))
    .digest("hex")
    .toUpperCase();
}

export function verifyInvoiceAllowanceCallbackCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIv: string,
) {
  const received = params.CheckMacValue?.toUpperCase();
  if (!received || !/^[A-F0-9]{32}$/.test(received)) return false;
  const expected = createInvoiceAllowanceCallbackCheckMacValue(
    params,
    hashKey,
    hashIv,
  );
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/**
 * A retry-stable, case-insensitive-safe ECPay RelateNumber.
 * The same business idempotency key always produces the same value.
 */
export function createInvoiceRelateNumber(
  idempotencyKey: string,
  prefix = "SYE",
) {
  const source = idempotencyKey.trim();
  const normalizedPrefix = prefix.trim().toUpperCase();
  if (!source) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  if (!/^[A-Z0-9]{1,8}$/.test(normalizedPrefix))
    throw new Error("INVALID_RELATE_NUMBER_PREFIX");
  const digest = createHash("sha256")
    .update(source, "utf8")
    .digest("hex")
    .toUpperCase();
  return `${normalizedPrefix}${digest}`.slice(0, 50);
}

/** Taiwan Ministry of Finance business-number check updated to modulus 5. */
export function isValidTaiwanBusinessNumber(value: string) {
  if (!/^\d{8}$/.test(value)) return false;
  const sum = [...value].reduce((total, digit, index) => {
    const product = Number(digit) * BUSINESS_NUMBER_WEIGHTS[index];
    return total + Math.floor(product / 10) + (product % 10);
  }, 0);
  return sum % 5 === 0;
}

/** Remove control characters and cap provider-bound text without losing CJK. */
export function sanitizeInvoiceText(value: string, maxLength: number) {
  if (!Number.isInteger(maxLength) || maxLength < 1)
    throw new Error("INVALID_MAX_LENGTH");
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Prevent Excel/CSV formula execution while retaining the displayed value. */
export function neutralizeSpreadsheetFormula(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(CONTROL_CHARACTERS, " ");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function isSafeSingleEmail(value: string) {
  if (value.length < 3 || value.length > 80 || /[\r\n;,]/.test(value))
    return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isSafeNotificationEmail(value: string) {
  if (value.length < 3 || value.length > 254 || /[\r\n;,]/.test(value))
    return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
