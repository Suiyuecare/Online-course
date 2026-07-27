import { z } from "zod";
import {
  mutation,
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
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("settle_live_attendance", {
      p_live_session_id: liveSessionId,
    });
    if (error) throw new Error("ATTENDANCE_SETTLEMENT_REJECTED");
    return { settledBookings: data };
  });
}
