import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  blindIndex,
  decryptWithDataKey,
  encryptWithDataKey,
} from "@/infrastructure/adapters/kms";
import { ManualBankAdapter } from "@/infrastructure/adapters/manual-bank";
import { ZoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import {
  verifyCloudflareStreamWebhook,
  verifyTimestampedHmac,
} from "@/infrastructure/security/signatures";

describe("envelope encryption and blind indexes", () => {
  it("round-trips AES-256-GCM with associated person context", () => {
    const key = randomBytes(32);
    const envelope = encryptWithDataKey(
      "A123456789",
      key,
      "person-1:national-id",
    );
    expect(decryptWithDataKey(envelope, key, "person-1:national-id")).toBe(
      "A123456789",
    );
  });

  it("rejects tampering and cross-person decryption", () => {
    const key = randomBytes(32);
    const envelope = encryptWithDataKey("secret", key, "person-1");
    expect(() => decryptWithDataKey(envelope, key, "person-2")).toThrow();
    expect(() =>
      decryptWithDataKey(
        {
          ...envelope,
          ciphertext: `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`,
        },
        key,
        "person-1",
      ),
    ).toThrow();
  });

  it("makes blind indexes deterministic only under the same key", () => {
    const current = "current-key-material-that-is-at-least-32-bytes";
    const previous = "previous-key-material-that-is-at-least-32-bytes";
    expect(blindIndex("A123456789", current)).toBe(
      blindIndex("A123456789", current),
    );
    expect(blindIndex("A123456789", current)).not.toBe(
      blindIndex("A123456789", previous),
    );
  });
});

describe("signed provider webhooks", () => {
  it("verifies Zoom timestamped HMAC and rejects replay", () => {
    const secret = "zoom-webhook-secret";
    const body = '{"event":"meeting.started"}';
    const timestamp = "1000";
    const signature = `v0=${createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
    expect(
      verifyTimestampedHmac({
        body,
        timestamp,
        signature,
        secret,
        nowMs: 1_000_000,
      }),
    ).toBe(true);
    expect(
      verifyTimestampedHmac({
        body,
        timestamp,
        signature,
        secret,
        nowMs: 2_000_000,
      }),
    ).toBe(false);
  });

  it("verifies Cloudflare signature and rejects a changed body", () => {
    const secret = "stream-secret";
    const body = '{"uid":"asset"}';
    const time = 1000;
    const signature = createHmac("sha256", secret)
      .update(`${time}.${body}`)
      .digest("hex");
    const header = `time=${time},sig1=${signature}`;
    expect(
      verifyCloudflareStreamWebhook({
        body,
        header,
        secret,
        nowSeconds: time,
      }),
    ).toBe(true);
    expect(
      verifyCloudflareStreamWebhook({
        body: `${body} `,
        header,
        secret,
        nowSeconds: time,
      }),
    ).toBe(false);
  });
});

describe("manual bank and Zoom secrecy boundaries", () => {
  it("fingerprints an immutable bank transaction canonically", () => {
    const adapter = new ManualBankAdapter();
    const row = adapter.parseRow({
      bookedOn: "2026-07-24",
      amountTwd: 1_200,
      remitterName: "王小明",
      accountLastFive: "12345",
      bankReference: "ledger-001",
    });
    expect(adapter.transactionFingerprint(row)).toMatch(/^[a-f0-9]{64}$/);
    expect(adapter.transactionFingerprint(row)).toBe(
      adapter.transactionFingerprint({ ...row }),
    );
  });

  it("rejects malformed bank rows before reconciliation", () => {
    expect(() =>
      new ManualBankAdapter().parseRow({
        bookedOn: "not-a-date",
        amountTwd: -1,
        remitterName: "",
        accountLastFive: "123",
        bankReference: "",
      }),
    ).toThrow();
  });

  it("creates a synthetic Zoom email that cannot encode person/order data", () => {
    const email = new ZoomMeetingAdapter().syntheticRegistrantEmail();
    expect(email).toMatch(/^[a-f0-9]{32}@zoom-id\.suiyuecare\.com$/);
  });

  it("rejects passcode or ZAK in URL-shaped data", () => {
    const adapter = new ZoomMeetingAdapter();
    expect(() =>
      adapter.assertSafeJoinPayload({
        passcode: "pass-secret",
        zak: "zak-secret",
        url: "https://example.test/join?pwd=pass-secret",
      }),
    ).toThrow("ZOOM_EPHEMERAL_SECRET_LEAK");
    expect(() =>
      adapter.assertSafeJoinPayload({
        passcode: "pass-secret",
        zak: "zak-secret",
        url: "https://example.test/join",
      }),
    ).not.toThrow();
  });
});
