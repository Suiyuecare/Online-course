import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("order"),
    bankTransactionId: z.uuid(),
    targetId: z.uuid(),
    amountTwd: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    targetType: z.literal("topup"),
    bankTransactionId: z.uuid(),
    targetId: z.uuid(),
    amountTwd: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      input.targetType === "order"
        ? "allocate_bank_transaction"
        : "allocate_bank_transaction_to_topup",
      input.targetType === "order"
        ? {
            p_bank_transaction_id: input.bankTransactionId,
            p_order_id: input.targetId,
            p_amount_twd: input.amountTwd,
            p_reason: input.reason,
            p_idempotency_key: requireIdempotencyKey(request),
          }
        : {
            p_bank_transaction_id: input.bankTransactionId,
            p_topup_id: input.targetId,
            p_amount_twd: input.amountTwd,
            p_reason: input.reason,
            p_idempotency_key: requireIdempotencyKey(request),
          },
    );
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
