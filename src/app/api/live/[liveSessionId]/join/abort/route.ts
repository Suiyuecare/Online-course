import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { zoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const abortContextSchema = z.object({
  leaseId: z.uuid(),
  liveSessionId: z.uuid(),
  meetingNumber: z.string().min(1),
  registrantId: z.string().nullable(),
  providerStatus: z.enum(["pending", "registered", "revoked", "failed"]),
  active: z.boolean(),
  credentialExpiresAt: z.iso.datetime({ offset: true }),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  return mutation(request, async () => {
    const { supabase, user } = await requireUser();
    await resolveActivePerson(supabase);
    const { liveSessionId } = await context.params;
    const input = await readJson(
      request,
      z.object({
        leaseId: z.uuid(),
        reason: z.enum(["sdk_join_failed", "check_in_failed"]),
      }),
    );
    const service = serviceSupabase();
    const { data, error } = await service.rpc("read_live_join_abort_context", {
      p_lease_id: input.leaseId,
      p_auth_user_id: user.id,
    });
    const abortContext = abortContextSchema.safeParse(data);
    if (
      error ||
      !abortContext.success ||
      abortContext.data.liveSessionId !== liveSessionId
    ) {
      throw new Error("LIVE_JOIN_ABORT_NOT_AUTHORIZED");
    }
    if (!abortContext.data.active) {
      return { accepted: true, alreadyInactive: true };
    }

    let registrantRevoked = false;
    if (abortContext.data.providerStatus === "registered") {
      if (!abortContext.data.registrantId) {
        throw new Error("ZOOM_REGISTRANT_CONTEXT_MISSING");
      }
      await zoomMeetingAdapter().revokeRegistrant(
        abortContext.data.meetingNumber,
        abortContext.data.registrantId,
      );
      registrantRevoked = true;
    }
    const { data: aborted, error: abortError } = await service.rpc(
      "abort_live_join_lease",
      {
        p_lease_id: input.leaseId,
        p_registrant_revoked: registrantRevoked,
        // Browser leave promises and SDK errors are not attendance authority.
        // Replacement remains fenced until a Zoom participant-left event or
        // credential expiry proves the old participant can no longer join.
        p_participant_removed: false,
        p_reason:
          input.reason === "sdk_join_failed"
            ? "sdk_join_failed"
            : "client_check_in_failed",
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (abortError || aborted !== true) {
      throw new Error("LIVE_JOIN_ABORT_FINALIZE_FAILED");
    }
    return { accepted: true, alreadyInactive: false };
  });
}
