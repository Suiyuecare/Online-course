import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { operationsIncidentActionSchema } from "@/application/operations-control-plane";
import { requireUser } from "@/infrastructure/supabase/server";

const stepUpNonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("propose"),
    action: operationsIncidentActionSchema,
    reason: z.string().trim().min(10).max(1000),
    evidenceReference: z.string().trim().min(3).max(500).nullable(),
    stepUpNonce,
  }),
  z.object({
    operation: z.literal("decide"),
    transitionRequestId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(10).max(1000),
    stepUpNonce,
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ incidentId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { incidentId } = await context.params;
    z.string().uuid().parse(incidentId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const nonceHash = createHash("sha256")
      .update(input.stepUpNonce)
      .digest("hex");

    if (input.operation === "propose") {
      const { data, error } = await supabase.rpc(
        "request_security_incident_transition",
        {
          p_incident_id: incidentId,
          p_action: input.action,
          p_reason: input.reason,
          p_evidence_reference: input.evidenceReference,
          p_idempotency_key: idempotencyKey,
          p_nonce_hash: nonceHash,
        },
      );
      if (error || !data) throw new Error("INCIDENT_TRANSITION_REJECTED");
      return { transitionRequestId: data, status: "pending_review" };
    }

    const { data, error } = await supabase.rpc(
      "decide_security_incident_transition",
      {
        p_transition_request_id: input.transitionRequestId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: idempotencyKey,
        p_nonce_hash: nonceHash,
      },
    );
    if (error || !data) {
      throw new Error("INCIDENT_TRANSITION_DECISION_REJECTED");
    }
    return data;
  });
}
