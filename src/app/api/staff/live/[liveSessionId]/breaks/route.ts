import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { liveBreakIntervalsSchema } from "@/domain/live-breaks";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  breakIntervals: liveBreakIntervalsSchema,
  reason: z.string().trim().min(10).max(1000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  return mutation(request, async () => {
    const { liveSessionId } = await context.params;
    z.uuid().parse(liveSessionId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("replace_draft_live_breaks", {
      p_live_session_id: liveSessionId,
      p_break_intervals: input.breakIntervals,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
