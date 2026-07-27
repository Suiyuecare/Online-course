import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  blindIndex,
  decryptWithDataKey,
  encryptWithDataKey,
  kmsAdapter,
  type Envelope,
} from "@/infrastructure/adapters/kms";
import { serverConfig } from "@/infrastructure/config";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const envelopeSchema = z.object({
  keyVersion: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

const bundleSchema = z.object({
  wrappedDek: envelopeSchema.optional(),
  kekVersion: z.string().min(1).optional(),
  encryptedFields: envelopeSchema.optional(),
  status: z.string().optional(),
});

export const accreditationIdentitySchema = z.object({
  enrollmentId: z.uuid(),
  realName: z.string().trim().min(2).max(80),
  nationalId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,20}$/),
  birthDate: z.iso.date(),
  careWorkerId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,40}$/),
  personnelCategory: z.string().trim().min(1).max(80),
  serviceUnit: z.string().trim().min(1).max(200),
});

export type AccreditationIdentityInput = z.infer<
  typeof accreditationIdentitySchema
>;

export async function resolveActivePerson(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("require_current_person");
  const personId = z.uuid().safeParse(data);
  if (error || !personId.success) {
    throw new Error("IDENTITY_RESTRICTED");
  }
  return personId.data;
}

async function personDataKey(personId: string) {
  const service = serviceSupabase();
  const { data: rawBundle, error: readError } = await service.rpc(
    "read_identity_encryption_bundle",
    { p_person_id: personId },
  );
  if (readError) throw new Error("IDENTITY_ENCRYPTION_UNAVAILABLE");
  const bundle = bundleSchema.parse(rawBundle ?? {});
  if (bundle.wrappedDek) {
    return {
      dataKey: await kmsAdapter().unwrapDataKey(personId, bundle.wrappedDek),
      wrappedDek: bundle.wrappedDek,
      kekVersion: bundle.kekVersion!,
    };
  }

  const config = serverConfig();
  if (!config.PII_KMS_KEY_ID) throw new Error("IDENTITY_KMS_KEY_MISSING");
  const generatedKey = randomBytes(32);
  const proposedWrapper = await kmsAdapter().wrapDataKey(
    personId,
    generatedKey,
  );
  const { data: ensuredRaw, error: ensureError } = await service.rpc(
    "ensure_person_encryption_key",
    {
      p_person_id: personId,
      p_wrapped_dek: proposedWrapper,
      p_kek_version: config.PII_KMS_KEY_ID,
    },
  );
  if (ensureError) throw new Error("IDENTITY_ENCRYPTION_UNAVAILABLE");
  const ensured = bundleSchema.parse(ensuredRaw ?? {});
  if (!ensured.wrappedDek || !ensured.kekVersion) {
    throw new Error("IDENTITY_ENCRYPTION_UNAVAILABLE");
  }
  const sameWrapper =
    JSON.stringify(ensured.wrappedDek) === JSON.stringify(proposedWrapper);
  return {
    dataKey: sameWrapper
      ? generatedKey
      : await kmsAdapter().unwrapDataKey(personId, ensured.wrappedDek),
    wrappedDek: ensured.wrappedDek,
    kekVersion: ensured.kekVersion,
  };
}

export async function storeAccreditationIdentity(input: {
  personId: string;
  phone: string;
  profile: AccreditationIdentityInput;
}) {
  const config = serverConfig();
  const currentBlindKey = config.PII_BLIND_INDEX_KEY_CURRENT;
  if (!currentBlindKey) throw new Error("PII_INDEX_CONFIGURATION_MISSING");
  const personId = z.uuid().parse(input.personId);
  const key = await personDataKey(personId);
  const associatedData = `identity-profile:${personId}`;
  const encryptedFields = encryptWithDataKey(
    JSON.stringify({
      realName: input.profile.realName,
      nationalId: input.profile.nationalId,
      birthDate: input.profile.birthDate,
      careWorkerId: input.profile.careWorkerId,
      personnelCategory: input.profile.personnelCategory,
      phone: input.phone,
      serviceUnit: input.profile.serviceUnit,
      schemaVersion: 1,
    }),
    key.dataKey,
    associatedData,
  );
  const previousBlindKey = config.PII_BLIND_INDEX_KEY_PREVIOUS;
  const national = input.profile.nationalId.toUpperCase();
  const careWorker = input.profile.careWorkerId.toUpperCase();
  const { data, error } = await serviceSupabase().rpc(
    "upsert_accreditation_identity_profile",
    {
      p_person_id: personId,
      p_enrollment_id: input.profile.enrollmentId,
      p_encrypted_fields: encryptedFields,
      p_wrapped_dek: key.wrappedDek,
      p_kek_version: key.kekVersion,
      p_national_index_current: blindIndex(national, currentBlindKey),
      p_national_index_previous: previousBlindKey
        ? blindIndex(national, previousBlindKey)
        : null,
      p_care_index_current: blindIndex(careWorker, currentBlindKey),
      p_care_index_previous: previousBlindKey
        ? blindIndex(careWorker, previousBlindKey)
        : null,
    },
  );
  if (error || !data) throw new Error("IDENTITY_PROFILE_REJECTED");
  return { status: "submitted" as const };
}

const verifiedIdentitySchema = z.object({
  realName: z.string().min(2).max(80),
  nationalId: z.string().min(8).max(20),
  birthDate: z.iso.date(),
  careWorkerId: z.string().min(4).max(40),
  personnelCategory: z.string().min(1).max(80),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  serviceUnit: z.string().min(1).max(200),
  schemaVersion: z.literal(1),
});

export async function readVerifiedAccreditationIdentity(personId: string) {
  const { data: rawBundle, error } = await serviceSupabase().rpc(
    "read_identity_encryption_bundle",
    { p_person_id: personId },
  );
  if (error) throw new Error("IDENTITY_ENCRYPTION_UNAVAILABLE");
  const bundle = bundleSchema.parse(rawBundle ?? {});
  if (
    bundle.status !== "verified" ||
    !bundle.wrappedDek ||
    !bundle.encryptedFields
  ) {
    throw new Error("VERIFIED_IDENTITY_REQUIRED");
  }
  const dataKey = await kmsAdapter().unwrapDataKey(
    personId,
    bundle.wrappedDek as Envelope,
  );
  return verifiedIdentitySchema.parse(
    JSON.parse(
      decryptWithDataKey(
        bundle.encryptedFields as Envelope,
        dataKey,
        `identity-profile:${personId}`,
      ),
    ),
  );
}

export async function readVerifiedIdentityName(personId: string) {
  return (await readVerifiedAccreditationIdentity(personId)).realName;
}
