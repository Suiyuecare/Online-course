import { describe, expect, it } from "vitest";
import { createZoomCrcResponse, createZoomWebhookSignature, verifyZoomWebhookRequest } from "./zoom-webhook-core";

describe("Zoom webhook verification", () => {
  const secret = "zoom-test-secret";
  const rawBody = JSON.stringify({ event: "meeting.started", event_ts: 1_800_000_000_000 });
  const timestamp = "1800000000";
  const now = 1_800_000_000_000;
  it("accepts a correct signature and rejects tampering", () => {
    const signature = createZoomWebhookSignature(rawBody, timestamp, secret);
    expect(verifyZoomWebhookRequest({ rawBody, timestamp, signature, secret, now })).toBe(true);
    expect(verifyZoomWebhookRequest({ rawBody: `${rawBody} `, timestamp, signature, secret, now })).toBe(false);
  });
  it("rejects stale timestamps to prevent replay", () => {
    const signature = createZoomWebhookSignature(rawBody, timestamp, secret);
    expect(verifyZoomWebhookRequest({ rawBody, timestamp, signature, secret, now: now + 301_000 })).toBe(false);
  });
  it("returns the CRC HMAC expected by Zoom", () => {
    const response = createZoomCrcResponse("plain-token", secret);
    expect(response.plainToken).toBe("plain-token");
    expect(response.encryptedToken).toMatch(/^[a-f0-9]{64}$/);
  });
});
