import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const { liveSessionId } = await context.params;
    z.uuid().parse(liveSessionId);
    const input = await readJson(
      request,
      z.object({
        personId: z.uuid(),
        role: z.enum(["assistant", "cohost", "reserved_support"]),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "assign_live_session_assistant",
      {
        p_live_session_id: liveSessionId,
        p_person_id: input.personId,
        p_role: input.role,
      },
    );
    if (error || !data) throw new Error("LIVE_ASSISTANT_REJECTED");
    return { assigned: true };
  });
}
