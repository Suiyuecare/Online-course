import { createHash, randomBytes } from "node:crypto";
import {
  blindIndex,
  encryptWithDataKey,
  kmsAdapter,
} from "@/infrastructure/adapters/kms";
import { serverConfig } from "@/infrastructure/config";

export function normalizeTaiwanMobile(phone: string) {
  const compact = phone.replace(/[\s()-]/g, "");
  if (/^09\d{8}$/.test(compact)) return `+886${compact.slice(1)}`;
  if (/^\+8869\d{8}$/.test(compact)) return compact;
  throw new Error("TAIWAN_MOBILE_REQUIRED");
}

export function invitationPhoneIndex(phone: string) {
  const key = serverConfig().ORGANIZATION_INVITATION_BLIND_INDEX_KEY;
  if (!key) throw new Error("INVITATION_INDEX_CONFIGURATION_MISSING");
  return blindIndex(normalizeTaiwanMobile(phone), key);
}

export function organizationTaxIdIndex(taxId: string) {
  if (!/^\d{8}$/.test(taxId)) throw new Error("TAIWAN_TAX_ID_REQUIRED");
  const key = serverConfig().PII_BLIND_INDEX_KEY_CURRENT;
  if (!key) throw new Error("PII_INDEX_CONFIGURATION_MISSING");
  return blindIndex(taxId, key);
}

export async function prepareOrganizationInvitation(input: {
  organizationId: string;
  phone: string;
}) {
  const phone = normalizeTaiwanMobile(input.phone);
  const token = randomBytes(32).toString("base64url");
  const dataKey = randomBytes(32);
  const encryptedPayload = encryptWithDataKey(
    JSON.stringify({ phone, token }),
    dataKey,
    `organization-invitation:${input.organizationId}`,
  );
  const wrappedDataKey = await kmsAdapter().wrapDataKey(
    `organization-invitation:${input.organizationId}`,
    dataKey,
  );
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    phoneBlindIndex: invitationPhoneIndex(phone),
    phoneCiphertext: {
      version: 1,
      encryptedPayload,
      wrappedDataKey,
    },
  };
}

export function invitationTokenHash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("INVITATION_TOKEN_REJECTED");
  }
  return createHash("sha256").update(token).digest("hex");
}
