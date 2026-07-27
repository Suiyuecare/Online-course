import { z } from "zod";
import { canonicalFingerprint } from "@/infrastructure/security/signatures";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const providerSchema = z.enum([
  "cloudflare_stream",
  "zoom",
  "resend",
  "twilio",
  "identity_recovery",
]);

export type ReceiptProvider = z.infer<typeof providerSchema>;

const receiptSchema = z.object({
  providerReference: z.string().nullable(),
  responsePayload: z.unknown(),
  recordedAt: z.iso.datetime({ offset: true }),
  reused: z.boolean().optional(),
});

export type ProviderOperationReceipt = z.infer<typeof receiptSchema>;

export async function readProviderOperationReceipt(input: {
  provider: ReceiptProvider;
  operation: string;
  businessKey: string;
}): Promise<ProviderOperationReceipt | null> {
  const provider = providerSchema.parse(input.provider);
  const { data, error } = await serviceSupabase().rpc(
    "read_provider_operation_receipt",
    {
      p_provider: provider,
      p_operation: input.operation,
      p_business_key: input.businessKey,
    },
  );
  if (error) throw new Error("PROVIDER_RECEIPT_READ_FAILED");
  if (data === null) return null;
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) throw new Error("PROVIDER_RECEIPT_INVALID");
  return parsed.data;
}

export async function recordProviderOperationReceipt(input: {
  provider: ReceiptProvider;
  operation: string;
  businessKey: string;
  providerReference: string | null;
  responsePayload: unknown;
}): Promise<ProviderOperationReceipt> {
  const provider = providerSchema.parse(input.provider);
  const { data, error } = await serviceSupabase().rpc(
    "record_provider_operation_receipt",
    {
      p_provider: provider,
      p_operation: input.operation,
      p_business_key: input.businessKey,
      p_provider_reference: input.providerReference ?? "",
      p_response_fingerprint: canonicalFingerprint(input.responsePayload),
      p_response_payload: input.responsePayload,
    },
  );
  const parsed = receiptSchema.safeParse(data);
  if (error || !parsed.success) {
    throw new Error("PROVIDER_RECEIPT_RECORD_FAILED");
  }
  return parsed.data;
}
