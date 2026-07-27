import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  return mutation(request, async () => {
    const { assignmentId } = await context.params;
    z.uuid().parse(assignmentId);
    const input = await readJson(
      request,
      z.object({
        liveSessionId: z.uuid(),
        liveComponentId: z.uuid().nullable().optional(),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "select_assignment_live_session",
      {
        p_assignment_id: assignmentId,
        p_live_session_id: input.liveSessionId,
        p_live_component_id: input.liveComponentId ?? null,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("ASSIGNMENT_SESSION_REJECTED");
    return { liveBookingId: data };
  });
}
