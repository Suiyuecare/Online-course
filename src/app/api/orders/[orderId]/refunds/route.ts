import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { encryptSensitivePayload } from "@/infrastructure/security/sensitive-envelope";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z
  .object({
    basis: z.enum([
      "consumer_withdrawal",
      "proportional_termination",
      "accreditation_failure",
      "provider_failure",
      "suiyue_cancellation",
      "material_change",
      "other",
    ]),
    reason: z.string().trim().min(10).max(2000),
    scopes: z
      .array(
        z.object({
          scopeType: z.enum(["recorded", "live_component", "whole_order"]),
          scopeId: z.uuid().nullable().optional(),
        }),
      )
      .min(1)
      .max(20),
    bankName: z.string().trim().min(2).max(100),
    bankCode: z.string().regex(/^\d{3}$/),
    accountNumber: z.string().regex(/^\d{6,20}$/),
    accountName: z.string().trim().min(2).max(100),
  })
  .superRefine((input, context) => {
    if (
      input.scopes.some((scope) => scope.scopeType === "whole_order") &&
      input.scopes.length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "whole-order refund cannot be combined",
      });
    }
    input.scopes.forEach((scope, index) => {
      if (scope.scopeType === "live_component" && !scope.scopeId) {
        context.addIssue({
          code: "custom",
          path: ["scopes", index, "scopeId"],
          message: "live scope ID required",
        });
      }
    });
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  return mutation(request, async () => {
    const { orderId } = await context.params;
    z.uuid().parse(orderId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data: orderData, error: orderError } = await supabase.rpc(
      "read_own_order",
      { p_order_id: orderId },
    );
    const order = z
      .object({ status: z.enum(["paid", "paid_unfulfilled"]) })
      .safeParse(orderData);
    if (orderError || !order.success) {
      throw new Error("REFUND_REQUEST_NOT_AUTHORIZED");
    }
    const caseId = randomUUID();
    const accountCiphertext = await encryptSensitivePayload(
      `refund-account:${caseId}`,
      {
        bankName: input.bankName,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
      },
    );
    const { data, error } = await supabase.rpc("request_refund", {
      p_refund_case_id: caseId,
      p_order_id: orderId,
      p_basis: input.basis,
      p_reason: input.reason,
      p_scopes: input.scopes,
      p_account_ciphertext: accountCiphertext,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("REFUND_REQUEST_REJECTED");
    return data;
  });
}
