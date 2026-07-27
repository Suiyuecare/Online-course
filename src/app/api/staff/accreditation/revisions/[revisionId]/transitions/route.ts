import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const base = {
  effectiveAt: z.iso.datetime({ offset: true }),
  sourceDocumentPath: z.string().trim().min(1).max(500),
  sourceDocumentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
};

const schema = z.discriminatedUnion("requestedStatus", [
  z.object({
    requestedStatus: z.literal("approved"),
    approvalReference: z.string().trim().min(2).max(200),
    points: z.number().positive().max(9999.99),
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    retroactive: z.boolean(),
    retroactiveBasis: z.string().trim().min(10).max(1000).nullable(),
    ...base,
  }),
  z.object({ requestedStatus: z.literal("rejected"), ...base }),
  z.object({ requestedStatus: z.literal("expired"), ...base }),
  z.object({ requestedStatus: z.literal("revoked"), ...base }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
) {
  return mutation(request, async () => {
    const { revisionId } = await context.params;
    z.uuid().parse(revisionId);
    const input = await readJson(request, schema);
    const approval =
      input.requestedStatus === "approved"
        ? {
            approvalReference: input.approvalReference,
            points: input.points,
            validFrom: input.validFrom,
            validUntil: input.validUntil,
            retroactive: input.retroactive,
            retroactiveBasis: input.retroactive ? input.retroactiveBasis : null,
          }
        : {
            approvalReference: null,
            points: null,
            validFrom: null,
            validUntil: null,
            retroactive: false,
            retroactiveBasis: null,
          };
    if (approval.retroactive && !approval.retroactiveBasis) {
      throw new Error("RETROACTIVE_BASIS_REQUIRED");
    }
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "request_accreditation_transition",
      {
        p_source_revision_id: revisionId,
        p_requested_status: input.requestedStatus,
        p_approval_reference: approval.approvalReference,
        p_points: approval.points,
        p_valid_from: approval.validFrom,
        p_valid_until: approval.validUntil,
        p_effective_at: input.effectiveAt,
        p_retroactive: approval.retroactive,
        p_retroactive_basis: approval.retroactiveBasis,
        p_source_document_path: input.sourceDocumentPath,
        p_source_document_sha256: input.sourceDocumentSha256,
        p_reason: input.reason,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) {
      throw new Error("ACCREDITATION_TRANSITION_REQUEST_REJECTED");
    }
    return { requestId: data };
  });
}
