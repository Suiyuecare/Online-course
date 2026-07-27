import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const effective = {
  effectiveAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(10).max(1000),
};

const schema = z.discriminatedUnion("settingKey", [
  z.object({
    settingKey: z.literal("legal_approved"),
    enabled: z.boolean(),
    ...effective,
  }),
  z.object({
    settingKey: z.literal("finance_configured"),
    enabled: z.boolean(),
    ...effective,
  }),
  z.object({
    settingKey: z.literal("incident_owner_configured"),
    enabled: z.boolean(),
    ...effective,
  }),
  z.object({
    settingKey: z.literal("bank_account"),
    bankName: z.string().trim().min(2).max(100),
    bankCode: z.string().regex(/^\d{3}$/),
    accountName: z.string().trim().min(2).max(100),
    accountNumber: z.string().regex(/^[\d -]{5,30}$/),
    ...effective,
  }),
  z.object({
    settingKey: z.literal("finance_high_value_threshold"),
    amountTwd: z.number().int().min(1).max(100_000_000),
    ...effective,
  }),
]);

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { settingKey, effectiveAt, reason, ...value } = input;
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "request_operating_setting_change",
      {
        p_setting_key: settingKey,
        p_value: value,
        p_effective_at: effectiveAt,
        p_reason: reason,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("OPERATING_SETTING_REQUEST_REJECTED");
    return { requestId: data };
  });
}
