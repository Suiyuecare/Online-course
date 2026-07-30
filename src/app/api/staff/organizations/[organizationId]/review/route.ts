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
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(10).max(1000),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "review_organization_application",
      {
        p_organization_id: organizationId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
