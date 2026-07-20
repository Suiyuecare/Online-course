import { describe, expect, it } from "vitest";
import {
  createInvoiceAllowanceCallbackCheckMacValue,
  createInvoiceRelateNumber,
  decryptEcpayInvoiceData,
  encryptEcpayInvoiceData,
  invoiceTimestamp,
  isSafeNotificationEmail,
  isSafeSingleEmail,
  isValidTaiwanBusinessNumber,
  neutralizeSpreadsheetFormula,
  sanitizeInvoiceText,
  verifyInvoiceAllowanceCallbackCheckMacValue,
} from "./ecpay-invoice-core";

describe("ECPay MIG 4.0 invoice helpers", () => {
  it("matches ECPay's published AES-128-CBC uppercase URL-encode example", () => {
    const encrypted = encryptEcpayInvoiceData(
      { Name: "Test", ID: "A123456789" },
      "ejCk326UnaZWKisg",
      "q9jcZX8Ib9LM8wYk",
    );
    expect(encrypted).toBe(
      "uvI4yrErM37XNQkXGAgRgJAgHn2t72jahaMZzYhWL1HmvH4WV18VJDP2i9pTbC+tby5nxVExLLFyAkbjbS2Dvg==",
    );
    expect(
      decryptEcpayInvoiceData(
        encrypted,
        "ejCk326UnaZWKisg",
        "q9jcZX8Ib9LM8wYk",
      ),
    ).toEqual({ Name: "Test", ID: "A123456789" });
  });

  it("matches ECPay's published allowance ReturnURL MD5 example", () => {
    const params = {
      RtnCode: "1",
      RtnMsg: "",
      IA_Allow_No: "1909181313013546",
      IA_Invoice_No: "UV11100019",
      IA_Date: "2019-09-18 13:13:23",
      IIS_Remain_Allowance_Amt: "0",
    };
    const checkMacValue = createInvoiceAllowanceCallbackCheckMacValue(
      params,
      "ejCk326UnaZWKisg",
      "q9jcZX8Ib9LM8wYk",
    );
    expect(checkMacValue).toBe("50A276E71DAE26343013958B405EEEA0");
    expect(
      verifyInvoiceAllowanceCallbackCheckMacValue(
        { ...params, CheckMacValue: checkMacValue },
        "ejCk326UnaZWKisg",
        "q9jcZX8Ib9LM8wYk",
      ),
    ).toBe(true);
    expect(
      verifyInvoiceAllowanceCallbackCheckMacValue(
        {
          ...params,
          IIS_Remain_Allowance_Amt: "1",
          CheckMacValue: checkMacValue,
        },
        "ejCk326UnaZWKisg",
        "q9jcZX8Ib9LM8wYk",
      ),
    ).toBe(false);
  });

  it("rejects AES material that is not exactly 16 bytes", () => {
    expect(() => encryptEcpayInvoiceData({}, "short", "1234567890123456"))
      .toThrowError("ECPAY_INVOICE_HASH_KEY_MUST_BE_16_BYTES");
  });

  it("creates a deterministic provider-safe RelateNumber", () => {
    const first = createInvoiceRelateNumber("order:123");
    expect(first).toMatch(/^SYE[A-F0-9]+$/);
    expect(first.length).toBeLessThanOrEqual(50);
    expect(first).toBe(createInvoiceRelateNumber("order:123"));
    expect(first).not.toBe(createInvoiceRelateNumber("order:124"));
  });

  it("creates whole-second Unix timestamps", () => {
    expect(invoiceTimestamp(new Date("2026-07-19T16:00:00.999Z"))).toBe(
      1_784_476_800,
    );
  });

  it("uses the Ministry of Finance modulus-5 business-number rule", () => {
    expect(isValidTaiwanBusinessNumber("04595257")).toBe(true);
    expect(isValidTaiwanBusinessNumber("10000004")).toBe(true);
    expect(isValidTaiwanBusinessNumber("04595258")).toBe(false);
    expect(isValidTaiwanBusinessNumber("1234567")).toBe(false);
  });

  it("neutralizes spreadsheet formulas and sanitizes provider text", () => {
    expect(neutralizeSpreadsheetFormula("=HYPERLINK(\"bad\")")).toBe(
      "'=HYPERLINK(\"bad\")",
    );
    expect(neutralizeSpreadsheetFormula("  @SUM(A1:A2)")).toBe(
      "'  @SUM(A1:A2)",
    );
    expect(neutralizeSpreadsheetFormula("安全文字")).toBe("安全文字");
    expect(sanitizeInvoiceText("  \u0000歲悅\n學苑  ", 20)).toBe("歲悅 學苑");
  });

  it("accepts one email address and rejects header/list injection", () => {
    expect(isSafeSingleEmail("billing@example.com")).toBe(true);
    expect(isSafeSingleEmail("a@example.com;evil@example.com")).toBe(false);
    expect(isSafeSingleEmail("a@example.com\r\nBcc:x@example.com")).toBe(false);
    expect(isSafeNotificationEmail(`${"a".repeat(90)}@example.com`)).toBe(true);
    expect(isSafeNotificationEmail("a@example.com;evil@example.com")).toBe(false);
  });
});
