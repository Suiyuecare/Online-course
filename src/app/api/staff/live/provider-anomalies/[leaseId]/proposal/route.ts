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
    resolutionKind: z.enum([
      "synthesize_left",
      "accept_provider_evidence",
      "disqualify_booking",
    ]),
    participantUuid: z.string().trim().min(1).max(500).nullable(),
    assumedLeftAt: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(10).max(1000),
    evidenceReference: z.string().trim().min(3).max(500),
    stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .superRefine((value, context) => {
    const synthetic = value.resolutionKind === "synthesize_left";
    if (
      (synthetic &&
        (value.participantUuid === null || value.assumedLeftAt === null)) ||
      (!synthetic &&
        (value.participantUuid !== null || value.assumedLeftAt !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "synthetic leave evidence does not match resolution",
        path: ["resolutionKind"],
      });
    }
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ leaseId: string }> },
) {
  return mutation(request, async () => {
    const { leaseId } = await context.params;
    z.uuid().parse(leaseId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "propose_provider_anomaly_resolution",
      {
        p_live_join_lease_id: leaseId,
        p_resolution_kind: input.resolutionKind,
        p_participant_uuid: input.participantUuid ?? "",
        p_assumed_left_at: input.assumedLeftAt,
        p_reason: input.reason,
        p_evidence_reference: input.evidenceReference,
        p_idempotency_key: requireIdempotencyKey(request),
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) {
      throw new Error("PROVIDER_ANOMALY_PROPOSAL_REJECTED");
    }
    return { resolutionRequestId: z.uuid().parse(data) };
  });
}
