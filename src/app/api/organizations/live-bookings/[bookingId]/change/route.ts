import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
) {
  return mutation(request, async () => {
    const { bookingId } = await context.params;
    z.uuid().parse(bookingId);
    const { replacementSessionId } = await readJson(
      request,
      z.object({ replacementSessionId: z.uuid() }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "change_assignment_live_session",
      {
        p_live_booking_id: bookingId,
        p_replacement_session_id: replacementSessionId,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("LIVE_SESSION_CHANGE_REJECTED");
    return { changed: true };
  });
}
