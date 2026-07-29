import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(
      request,
      z.object({
        action: z.enum(["suspend", "reactivate"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("change_organization_status", {
      p_organization_id: organizationId,
      p_action: input.action,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
      p_idempotency_key: idempotencyKey,
    });
    if (error || !data) {
      throw new Error("ORGANIZATION_STATUS_CHANGE_REJECTED");
    }
    return data;
  });
}
