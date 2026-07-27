import { z } from "zod";
import { decryptWithDataKey, kmsAdapter } from "@/infrastructure/adapters/kms";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const envelope = z.object({
  keyVersion: z.string(),
  iv: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});

const profile = z.object({
  realName: z.string().min(2).max(80),
  nationalId: z.string().min(8).max(20),
  birthDate: z.iso.date(),
  careWorkerId: z.string().min(4).max(40),
  personnelCategory: z.string().min(1).max(80),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  serviceUnit: z.string().min(1).max(200),
  schemaVersion: z.literal(1),
});

export async function readSubmittedIdentityForReview(input: {
  accessGrantId: string;
  caseId: string;
  actorId: string;
}) {
  const { data, error } = await serviceSupabase().rpc(
    "consume_identity_review_access",
    {
      p_grant_id: input.accessGrantId,
      p_case_id: input.caseId,
      p_actor_id: input.actorId,
    },
  );
  const bundle = z
    .object({
      personId: z.uuid(),
      wrappedDek: envelope,
      encryptedFields: envelope,
      status: z.enum(["submitted", "needs_correction", "verified"]),
    })
    .safeParse(data);
  if (error || !bundle.success) throw new Error("IDENTITY_REVIEW_UNAVAILABLE");
  const key = await kmsAdapter().unwrapDataKey(
    bundle.data.personId,
    bundle.data.wrappedDek,
  );
  return profile.parse(
    JSON.parse(
      decryptWithDataKey(
        bundle.data.encryptedFields,
        key,
        `identity-profile:${bundle.data.personId}`,
      ),
    ),
  );
}
