import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z
  .object({
    action: z.enum(["reschedule", "cancel"]),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    bookingCloseAt: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(10).max(2000),
  })
  .superRefine((value, context) => {
    if (
      value.action === "reschedule" &&
      (!value.startsAt || !value.endsAt || !value.bookingCloseAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "replacement schedule required",
      });
    }
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
    const { data, error } = await supabase.rpc("request_live_session_change", {
      p_live_session_id: liveSessionId,
      p_action: input.action,
      p_replacement_starts_at: input.startsAt,
      p_replacement_ends_at: input.endsAt,
      p_replacement_booking_close_at: input.bookingCloseAt,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("LIVE_SESSION_CHANGE_REJECTED");
    return data;
  });
}
