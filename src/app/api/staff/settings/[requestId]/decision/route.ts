import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutation(request, async () => {
    const { requestId } = await context.params;
    z.uuid().parse(requestId);
    const input = await readJson(
      request,
      z.object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "decide_operating_setting_change",
      {
        p_request_id: requestId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) throw new Error("OPERATING_SETTING_DECISION_REJECTED");
    return data;
  });
}
