import { createHmac, timingSafeEqual } from "node:crypto";

export function createZoomWebhookSignature(rawBody: string, timestamp: string, secret: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

export function verifyZoomWebhookRequest(input: { rawBody: string; timestamp: string | null; signature: string | null; secret: string; now?: number }) {
  if (!input.timestamp || !input.signature || !input.secret) return false;
  const seconds = Number(input.timestamp);
  if (!Number.isFinite(seconds) || Math.abs((input.now ?? Date.now()) - seconds * 1000) > 5 * 60_000) return false;
  const expected = Buffer.from(createZoomWebhookSignature(input.rawBody, input.timestamp, input.secret));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createZoomCrcResponse(plainToken: string, secret: string) {
  return { plainToken, encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex") };
}
