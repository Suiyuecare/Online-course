import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import "server-only";

function key() {
  const raw = process.env.LIVE_SECRET_ENCRYPTION_KEY;
  if (!raw) return null;
  const value = /^[a-f\d]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  return value.length === 32 ? value : null;
}

export function isLiveSecretEncryptionConfigured() {
  return Boolean(key());
}

export function encryptLiveSecret(value: string) {
  const secret = key();
  if (!secret) throw new Error("LIVE_SECRET_ENCRYPTION_KEY_NOT_CONFIGURED");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptLiveSecret(value: string) {
  const secret = key();
  if (!secret) throw new Error("LIVE_SECRET_ENCRYPTION_KEY_NOT_CONFIGURED");
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("INVALID_LIVE_SECRET");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
