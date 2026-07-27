import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const prerequisiteKind = z.enum([
  "operating_setting",
  "organizing_body",
  "accreditation_authority",
  "accreditation_revision",
  "retention_policy_revision",
  "legal_document_revision",
  "zoom_host_resource",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ prerequisiteId: string }> },
) {
  return mutation(request, async () => {
    const { prerequisiteId } = await context.params;
    z.uuid().parse(prerequisiteId);
    const input = await readJson(
      request,
      z.object({
        kind: prerequisiteKind,
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("decide_platform_prerequisite", {
      p_kind: input.kind,
      p_target_id: prerequisiteId,
      p_decision: input.decision,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("PREREQUISITE_DECISION_REJECTED");
    return data;
  });
}
