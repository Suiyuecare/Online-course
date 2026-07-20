import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptAccreditationIdentity,
  encryptAccreditationIdentity,
  maskNationalId,
  nationalIdFingerprint,
  normalizeNationalId,
} from "./accreditation-crypto-core";

const previousKey = process.env.LEARNER_DATA_ENCRYPTION_KEY;

describe("accreditation identity encryption", () => {
  beforeEach(() => {
    process.env.LEARNER_DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    if (previousKey === undefined)
      delete process.env.LEARNER_DATA_ENCRYPTION_KEY;
    else process.env.LEARNER_DATA_ENCRYPTION_KEY = previousKey;
  });

  it("round-trips AES-256-GCM data without exposing plaintext", () => {
    const identity = {
      fullName: "測試學員",
      nationalId: "A123456789",
      longTermCareNumber: "LT-100",
      phone: "0912345678",
      organization: "測試機構",
    };
    const encrypted = encryptAccreditationIdentity(identity);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(identity.nationalId);
    expect(decryptAccreditationIdentity(encrypted)).toEqual(identity);
  });

  it("normalizes, masks and fingerprints identifiers consistently", () => {
    expect(normalizeNationalId(" a123 456789 ")).toBe("A123456789");
    expect(maskNationalId("A123456789")).toBe("A1******89");
    expect(nationalIdFingerprint("a123 456789")).toBe(
      nationalIdFingerprint("A123456789"),
    );
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptAccreditationIdentity({
      fullName: "甲",
      nationalId: "A123456789",
      longTermCareNumber: "",
      phone: "",
      organization: "",
    });
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const tampered = `${version}.${iv}.${tag}.${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(() => decryptAccreditationIdentity(tampered)).toThrow();
  });
});
