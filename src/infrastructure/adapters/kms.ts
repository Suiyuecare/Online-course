import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

export type Envelope = {
  keyVersion: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

const envelopeSchema = z.object({
  keyVersion: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});
const managedKmsResponse = z.object({
  envelope: envelopeSchema.optional(),
  dataKey: z.string().min(1).optional(),
});

export interface KmsAdapter {
  wrapDataKey(personId: string, dataKey: Uint8Array): Promise<Envelope>;
  unwrapDataKey(personId: string, envelope: Envelope): Promise<Uint8Array>;
}

export class ManagedKmsAdapter implements KmsAdapter {
  private readonly config = serverConfig();

  private async invoke(
    operation: "wrap" | "unwrap",
    input: Record<string, unknown>,
  ) {
    const endpoint = this.config.PII_KMS_ENDPOINT;
    const keyId = this.config.PII_KMS_KEY_ID;
    const token = this.config.PII_KMS_ACCESS_TOKEN;
    if (
      this.config.PII_KMS_PROVIDER === "local" ||
      !endpoint ||
      !keyId ||
      !token
    ) {
      throw new Error("MANAGED_KMS_UNAVAILABLE");
    }
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/v1/keys/${encodeURIComponent(keyId)}:${operation}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );
    const payload = managedKmsResponse.safeParse(
      await response.json().catch(() => null),
    );
    if (!response.ok || !payload.success) {
      throw new Error("MANAGED_KMS_REQUEST_FAILED");
    }
    return payload.data;
  }

  async wrapDataKey(personId: string, dataKey: Uint8Array) {
    const payload = await this.invoke("wrap", {
      context: personId,
      dataKey: Buffer.from(dataKey).toString("base64url"),
    });
    if (!payload.envelope) throw new Error("MANAGED_KMS_RESPONSE_INVALID");
    return payload.envelope;
  }

  async unwrapDataKey(personId: string, envelope: Envelope) {
    const payload = await this.invoke("unwrap", {
      context: personId,
      envelope,
    });
    if (!payload.dataKey) throw new Error("MANAGED_KMS_RESPONSE_INVALID");
    const key = Buffer.from(payload.dataKey, "base64url");
    if (key.length !== 32) throw new Error("MANAGED_KMS_RESPONSE_INVALID");
    return key;
  }
}

export class LocalKmsAdapter implements KmsAdapter {
  private readonly masterKey: Uint8Array;

  constructor(encodedKey = serverConfig().LOCAL_KMS_MASTER_KEY) {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      }) ||
      !encodedKey
    ) {
      throw new Error("LOCAL_KMS_DISABLED");
    }
    this.masterKey = Buffer.from(encodedKey, "base64url");
    if (this.masterKey.byteLength !== 32) {
      throw new Error("LOCAL_KMS_KEY_INVALID");
    }
  }

  async wrapDataKey(personId: string, dataKey: Uint8Array) {
    return encryptWithDataKey(
      Buffer.from(dataKey).toString("base64url"),
      this.masterKey,
      `kms:${personId}`,
    );
  }

  async unwrapDataKey(personId: string, envelope: Envelope) {
    const key = Buffer.from(
      decryptWithDataKey(envelope, this.masterKey, `kms:${personId}`),
      "base64url",
    );
    if (key.length !== 32) throw new Error("LOCAL_KMS_KEY_INVALID");
    return key;
  }
}

export function kmsAdapter(): KmsAdapter {
  return serverConfig().PII_KMS_PROVIDER === "local"
    ? new LocalKmsAdapter()
    : new ManagedKmsAdapter();
}

export function encryptWithDataKey(
  plaintext: string,
  dataKey: Uint8Array,
  associatedData: string,
): Envelope {
  if (dataKey.byteLength !== 32) throw new Error("INVALID_DATA_KEY");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    keyVersion: "dek-v1",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptWithDataKey(
  envelope: Envelope,
  dataKey: Uint8Array,
  associatedData: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dataKey,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function blindIndex(normalizedValue: string, key: string): string {
  if (key.length < 32) throw new Error("BLIND_INDEX_KEY_TOO_SHORT");
  return createHmac("sha256", key).update(normalizedValue).digest("hex");
}
