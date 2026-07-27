import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z
  .object({
    resolutionKind: z.enum(["confirm_not_created", "register_existing"]),
    providerMeetingNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{9,12}$/)
      .nullable(),
    reason: z.string().trim().min(10).max(1000),
    evidenceReference: z.string().trim().min(3).max(500),
    stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .superRefine((value, context) => {
    if (
      (value.resolutionKind === "register_existing" &&
        value.providerMeetingNumber === null) ||
      (value.resolutionKind === "confirm_not_created" &&
        value.providerMeetingNumber !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "provider meeting number does not match resolution",
        path: ["providerMeetingNumber"],
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
    const { data, error } = await supabase.rpc(
      "propose_zoom_setup_reconciliation",
      {
        p_live_session_id: liveSessionId,
        p_resolution_kind: input.resolutionKind,
        p_provider_meeting_number: input.providerMeetingNumber ?? "",
        p_reason: input.reason,
        p_evidence_reference: input.evidenceReference,
        p_idempotency_key: requireIdempotencyKey(request),
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) {
      throw new Error("ZOOM_RECONCILIATION_PROPOSAL_REJECTED");
    }
    return { reconciliationRequestId: z.uuid().parse(data) };
  });
}
