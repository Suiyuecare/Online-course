import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export type AccreditationIdentity = {
  fullName: string;
  nationalId: string;
  longTermCareNumber: string;
  phone: string;
  organization: string;
};

function encryptionKey() {
  const raw = process.env.LEARNER_DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = /^[a-f\d]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function isLearnerEncryptionConfigured() {
  return Boolean(encryptionKey());
}

export function encryptAccreditationIdentity(payload: AccreditationIdentity) {
  const key = encryptionKey();
  if (!key) throw new Error("LEARNER_DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptAccreditationIdentity(
  value: string,
): AccreditationIdentity {
  const key = encryptionKey();
  if (!key) throw new Error("LEARNER_DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue)
    throw new Error("INVALID_ENCRYPTED_IDENTITY");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as AccreditationIdentity;
}

export function nationalIdFingerprint(nationalId: string) {
  const key = encryptionKey();
  if (!key) throw new Error("LEARNER_DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  return createHmac("sha256", key)
    .update(normalizeNationalId(nationalId))
    .digest("hex");
}
export function normalizeNationalId(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}
export function maskNationalId(value: string) {
  const normalized = normalizeNationalId(value);
  if (normalized.length < 5) return "***";
  return `${normalized.slice(0, 2)}${"*".repeat(Math.max(3, normalized.length - 4))}${normalized.slice(-2)}`;
}
