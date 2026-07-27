import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { encryptSensitivePayload } from "@/infrastructure/security/sensitive-envelope";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  pointTopupId: z.uuid(),
  points: z.number().int().positive().max(10_000_000),
  reason: z.string().trim().min(10).max(2000),
  bankName: z.string().trim().min(2).max(100),
  bankCode: z.string().regex(/^\d{3}$/),
  accountNumber: z.string().regex(/^\d{6,20}$/),
  accountName: z.string().trim().min(2).max(100),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data: authorizedActor, error: authorizationError } =
      await supabase.rpc("authorize_point_refund_preparation", {
        p_organization_id: organizationId,
        p_point_topup_id: input.pointTopupId,
        p_points: input.points,
      });
    if (authorizationError || !z.uuid().safeParse(authorizedActor).success) {
      throw new Error("POINT_REFUND_REQUEST_NOT_AUTHORIZED");
    }
    const pointRefundCaseId = randomUUID();
    const accountCiphertext = await encryptSensitivePayload(
      `point-refund-account:${pointRefundCaseId}`,
      {
        bankName: input.bankName,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
      },
    );
    const { data, error } = await supabase.rpc("request_point_refund", {
      p_point_refund_case_id: pointRefundCaseId,
      p_organization_id: organizationId,
      p_point_topup_id: input.pointTopupId,
      p_points: input.points,
      p_account_details_ciphertext: accountCiphertext,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("POINT_REFUND_REQUEST_REJECTED");
    return data;
  });
}
