import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverConfig } from "@/infrastructure/config";

export type ProviderSecretEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

function zoomKey() {
  const encoded = serverConfig().ZOOM_SECRET_ENCRYPTION_KEY;
  if (!encoded) throw new Error("ZOOM_SECRET_ENCRYPTION_UNAVAILABLE");
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) throw new Error("ZOOM_SECRET_ENCRYPTION_INVALID");
  return key;
}

export function encryptZoomSecret(
  plaintext: string,
  context: string,
): ProviderSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", zoomKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptZoomSecret(
  envelope: ProviderSecretEnvelope,
  context: string,
): string {
  if (envelope.version !== 1) throw new Error("ZOOM_SECRET_VERSION_REJECTED");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    zoomKey(),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
