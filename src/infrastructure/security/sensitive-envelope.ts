import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  decryptWithDataKey,
  encryptWithDataKey,
  type Envelope,
  kmsAdapter,
} from "@/infrastructure/adapters/kms";

const sensitiveEnvelope = z.object({
  version: z.literal(1),
  encryptedPayload: z.object({
    keyVersion: z.string(),
    iv: z.string(),
    ciphertext: z.string(),
    tag: z.string(),
  }),
  wrappedDataKey: z.object({
    keyVersion: z.string(),
    iv: z.string(),
    ciphertext: z.string(),
    tag: z.string(),
  }),
});

export async function encryptSensitivePayload(
  context: string,
  value: Record<string, unknown>,
) {
  const dataKey = randomBytes(32);
  return {
    version: 1,
    encryptedPayload: encryptWithDataKey(
      JSON.stringify(value),
      dataKey,
      context,
    ),
    wrappedDataKey: await kmsAdapter().wrapDataKey(context, dataKey),
  };
}

export async function decryptSensitivePayload(context: string, value: unknown) {
  const parsed = sensitiveEnvelope.parse(value);
  const dataKey = await kmsAdapter().unwrapDataKey(
    context,
    parsed.wrappedDataKey as Envelope,
  );
  return z
    .record(z.string(), z.unknown())
    .parse(
      JSON.parse(decryptWithDataKey(parsed.encryptedPayload, dataKey, context)),
    );
}
