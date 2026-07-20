import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptEcpayInvoiceData,
  encryptEcpayInvoiceData,
} from "./ecpay-invoice-core";
import {
  EcpayInvoiceClient,
  EcpayInvoiceError,
  isAmbiguousEcpayAllowanceError,
  isEcpayEnvironmentPairValid,
  isEcpayInvoiceConfigured,
} from "./ecpay-invoice";

const config = {
  merchantId: "2000132",
  hashKey: "ejCk326UnaZWKisg",
  hashIv: "q9jcZX8Ib9LM8wYk",
  origin: "https://einvoice-stage.ecpay.com.tw",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ECPay invoice client", () => {
  it("refuses stage/production payment and invoice environment mismatches", () => {
    expect(isEcpayEnvironmentPairValid("stage", "stage")).toBe(true);
    expect(isEcpayEnvironmentPairValid("production", "production")).toBe(
      true,
    );
    expect(isEcpayEnvironmentPairValid("stage", "production")).toBe(false);
    expect(isEcpayEnvironmentPairValid("production", "stage")).toBe(false);
    expect(isEcpayEnvironmentPairValid(undefined, "stage")).toBe(false);
  });

  it("does not report invoice readiness when payment and invoice environments differ", () => {
    vi.stubEnv("ECPAY_INVOICE_MERCHANT_ID", "2000132");
    vi.stubEnv("ECPAY_INVOICE_HASH_KEY", config.hashKey);
    vi.stubEnv("ECPAY_INVOICE_HASH_IV", config.hashIv);
    vi.stubEnv("ECPAY_ENV", "stage");
    vi.stubEnv("ECPAY_INVOICE_ENV", "production");
    expect(isEcpayInvoiceConfigured()).toBe(false);
    vi.stubEnv("ECPAY_INVOICE_ENV", "stage");
    expect(isEcpayInvoiceConfigured()).toBe(true);
  });

  it("separates definitive rejection from an ambiguous provider result", () => {
    expect(
      isAmbiguousEcpayAllowanceError(
        new EcpayInvoiceError("PROVIDER_REJECTED", "rejected"),
      ),
    ).toBe(false);
    expect(
      isAmbiguousEcpayAllowanceError(
        new EcpayInvoiceError("INVALID_RESPONSE", "unknown result"),
      ),
    ).toBe(true);
    expect(isAmbiguousEcpayAllowanceError(new TypeError("fetch failed"))).toBe(
      true,
    );
  });

  it("issues a tax-ID invoice and verifies decrypted RtnCode", async () => {
    let requestData: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const envelope = JSON.parse(String(init.body)) as { Data: string };
        requestData = decryptEcpayInvoiceData(
          envelope.Data,
          config.hashKey,
          config.hashIv,
        );
        return Response.json({
          TransCode: 1,
          Data: encryptEcpayInvoiceData(
            {
              RtnCode: 1,
              RtnMsg: "開立發票成功",
              InvoiceNo: "UV11100012",
              InvoiceDate: "2026-07-20 09:30:00",
              RandomNumber: "6866",
            },
            config.hashKey,
            config.hashIv,
          ),
        });
      }),
    );

    const result = await new EcpayInvoiceClient(config).issue({
      relateNumber: "SYE123",
      customerIdentifier: "04595257",
      customerName: "歲悅測試機構",
      customerEmail: "billing@example.com",
      salesAmountTwd: 500,
      items: [
        {
          name: "照護課程企業名額",
          count: 5,
          unitPriceTwd: 100,
          amountTwd: 500,
        },
      ],
    });

    expect(result.invoiceNumber).toBe("UV11100012");
    expect(requestData).toMatchObject({
      CustomerIdentifier: "04595257",
      Print: "0",
      CarrierType: "1",
      SalesAmount: 500,
    });
  });

  it("does not mistake transport success for invoice success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          TransCode: 1,
          Data: encryptEcpayInvoiceData(
            { RtnCode: 0, RtnMsg: "RelateNumber duplicated" },
            config.hashKey,
            config.hashIv,
          ),
        }),
      ),
    );
    await expect(
      new EcpayInvoiceClient(config).issue({
        relateNumber: "SYEDUPLICATE",
        customerIdentifier: "04595257",
        customerName: "歲悅測試機構",
        customerEmail: "billing@example.com",
        salesAmountTwd: 100,
        items: [
          {
            name: "企業名額",
            count: 1,
            unitPriceTwd: 100,
            amountTwd: 100,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it("can recover a completed invoice by its retry-stable RelateNumber", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          TransCode: 1,
          Data: encryptEcpayInvoiceData(
            {
              RtnCode: 1,
              RtnMsg: "success",
              IIS_Number: "UV11100012",
              IIS_Relate_Number: "SYE123",
              IIS_Create_Date: "2026-07-20 09:30:00",
              IIS_Random_Number: "6866",
              IIS_Sales_Amount: 500,
            },
            config.hashKey,
            config.hashIv,
          ),
        }),
      ),
    );
    await expect(
      new EcpayInvoiceClient(config).findByRelateNumber("SYE123"),
    ).resolves.toMatchObject({
      invoiceNumber: "UV11100012",
      salesAmountTwd: 500,
      recovered: true,
    });
  });

  it("marks an online allowance as pending buyer consent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          TransCode: 1,
          Data: encryptEcpayInvoiceData(
            {
              RtnCode: 1,
              RtnMsg: "折讓單資料新增成功",
              IA_Allow_No: "1909181313013546",
              IA_TempDate: "2026-07-20 10:00:00",
              IA_TempExpireDate: "2026-07-23 10:00:00",
              IA_Remain_Allowance_Amt: 400,
            },
            config.hashKey,
            config.hashIv,
          ),
        }),
      ),
    );
    const result = await new EcpayInvoiceClient(config).createAllowance({
      invoiceNumber: "UV11100012",
      invoiceDate: "2026-07-20",
      customerName: "歲悅測試機構",
      customerEmail: "billing@example.com",
      allowanceAmountTwd: 100,
      reason: "未使用名額退費",
      items: [
        {
          name: "企業名額",
          count: 1,
          unitPriceTwd: 100,
          amountTwd: 100,
        },
      ],
      returnUrl: "https://academy.example.com/api/webhooks/ecpay/allowance",
    });
    expect(result.requiresBuyerConsent).toBe(true);
    expect(result.temporaryAllowanceNumber).toBe("1909181313013546");
  });
});
