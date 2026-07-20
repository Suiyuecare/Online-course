import { describe, expect, it } from "vitest";
import {
  configuredEcpayCheckoutUrl,
  createCheckMacValue,
  createMerchantTradeNo,
  taipeiTradeDate,
  verifyCheckMacValue,
} from "./ecpay";

describe("ECPay helpers", () => {
  it("only accepts the checkout URL selected by ECPAY_ENV", () => {
    const originalEnvironment = process.env.ECPAY_ENV;
    const originalUrl = process.env.ECPAY_CHECKOUT_URL;
    try {
      process.env.ECPAY_ENV = "production";
      process.env.ECPAY_CHECKOUT_URL =
        "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
      expect(configuredEcpayCheckoutUrl()).toBe(process.env.ECPAY_CHECKOUT_URL);
      process.env.ECPAY_CHECKOUT_URL =
        "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
      expect(configuredEcpayCheckoutUrl()).toBeNull();
    } finally {
      if (originalEnvironment === undefined) delete process.env.ECPAY_ENV;
      else process.env.ECPAY_ENV = originalEnvironment;
      if (originalUrl === undefined) delete process.env.ECPAY_CHECKOUT_URL;
      else process.env.ECPAY_CHECKOUT_URL = originalUrl;
    }
  });

  it("matches ECPay's published AioCheckOut SHA256 example", () => {
    const params = {
      ChoosePayment: "ALL",
      EncryptType: "1",
      ItemName: "Apple iphone 15",
      MerchantID: "3002607",
      MerchantTradeDate: "2023/03/12 15:30:23",
      MerchantTradeNo: "ecpay20230312153023",
      PaymentType: "aio",
      ReturnURL: "https://www.ecpay.com.tw/receive.php",
      TotalAmount: "30000",
      TradeDesc: "促銷方案",
    };
    expect(
      createCheckMacValue(params, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs"),
    ).toBe("6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840");
  });

  it("creates a deterministic uppercase SHA256 CheckMacValue", () => {
    const params = {
      MerchantID: "3002607",
      MerchantTradeNo: "SY2607191234000001",
      TotalAmount: "100",
    };
    const value = createCheckMacValue(
      params,
      "pwFHCqoQZGmho4w6",
      "EkRm7iFT261dpevs",
    );
    expect(value).toMatch(/^[A-F0-9]{64}$/);
    expect(value).toBe(
      createCheckMacValue(params, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs"),
    );
    expect(
      verifyCheckMacValue(
        { ...params, CheckMacValue: value },
        "pwFHCqoQZGmho4w6",
        "EkRm7iFT261dpevs",
      ),
    ).toBe(true);
  });

  it("formats Taipei time and keeps merchant trade number within 20 characters", () => {
    const date = new Date("2026-07-19T04:34:56.000Z");
    expect(taipeiTradeDate(date)).toBe("2026/07/19 12:34:56");
    expect(createMerchantTradeNo(date, 42)).toBe("SY260719123456000042");
  });
});
