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
    const { supabase } = await requireUser();
    const { liveSessionId } = await context.params;
    const input = await readJson(
      request,
      z.object({
        event: z.enum(["check_in", "check_out"]),
        deviceTestPassed: z.boolean(),
      }),
    );
    const { data, error } = await supabase.rpc("record_live_check_event", {
      p_live_session_id: liveSessionId,
      p_event_type: input.event,
      p_device_test_passed: input.deviceTestPassed,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error) throw new Error("LIVE_CHECK_REJECTED");
    return data;
  });
}
