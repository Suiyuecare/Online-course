import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const effectiveLegalDocumentSchema = z.object({
  documentId: z.string().uuid(),
  kind: z.enum([
    "b2c_contract",
    "b2b_contract",
    "privacy_notice",
    "refund_policy",
    "pending_accreditation_disclosure",
  ]),
  revision: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  effectiveAt: z.string(),
  downloadPath: z.string().regex(/^\/api\/legal\/documents\/[0-9a-f-]{36}$/),
});

export type EffectiveLegalDocument = z.infer<
  typeof effectiveLegalDocumentSchema
>;

export async function readEffectiveLegalCenter(
  client: SupabaseClient,
): Promise<EffectiveLegalDocument[]> {
  const { data, error } = await client.rpc("read_effective_legal_center");
  if (error) throw new Error("LEGAL_CENTER_UNAVAILABLE");
  const parsed = z.array(effectiveLegalDocumentSchema).safeParse(data);
  if (!parsed.success) throw new Error("LEGAL_CENTER_INVALID");
  return parsed.data;
}
