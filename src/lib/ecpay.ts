import { createHash, timingSafeEqual } from "node:crypto";

export const ECPAY_STAGE_URL =
  "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
export const ECPAY_PRODUCTION_URL =
  "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";

export function configuredEcpayCheckoutUrl() {
  const expected =
    process.env.ECPAY_ENV === "production"
      ? ECPAY_PRODUCTION_URL
      : ECPAY_STAGE_URL;
  const configured = process.env.ECPAY_CHECKOUT_URL?.trim();
  return !configured || configured === expected ? expected : null;
}

export type EcpayParams = Record<string, string>;

function ecpayUrlEncode(value: string) {
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

export function createCheckMacValue(
  params: EcpayParams,
  hashKey: string,
  hashIv: string,
) {
  const filtered = Object.entries(params).filter(
    ([key]) => key !== "CheckMacValue",
  );
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const source = `HashKey=${hashKey}&${filtered.map(([key, value]) => `${key}=${value}`).join("&")}&HashIV=${hashIv}`;
  return createHash("sha256")
    .update(ecpayUrlEncode(source))
    .digest("hex")
    .toUpperCase();
}

export function verifyCheckMacValue(
  params: EcpayParams,
  hashKey: string,
  hashIv: string,
) {
  const received = params.CheckMacValue?.toUpperCase();
  if (!received) return false;
  const expected = createCheckMacValue(params, hashKey, hashIv);
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function taipeiTradeDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}/${value.month}/${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export function createMerchantTradeNo(
  date = new Date(),
  random = Math.floor(Math.random() * 1_000_000),
) {
  const compact = taipeiTradeDate(date).replace(/\D/g, "").slice(2);
  return `SY${compact}${String(random).padStart(6, "0")}`.slice(0, 20);
}
