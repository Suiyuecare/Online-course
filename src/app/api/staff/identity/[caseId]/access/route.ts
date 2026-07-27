import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  return mutation(request, async () => {
    const { caseId } = await context.params;
    z.uuid().parse(caseId);
    const input = await readJson(
      request,
      z.object({
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "approve_identity_profile_access",
      {
        p_case_id: caseId,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    const authorization = z
      .object({
        ready: z.boolean(),
        approvalCount: z.number().int().min(1),
        accessGrantId: z.uuid().nullable(),
        actorId: z.uuid().nullable(),
      })
      .safeParse(data);
    if (error || !authorization.success) {
      throw new Error("IDENTITY_ACCESS_REJECTED");
    }
    if (
      !authorization.data.ready ||
      !authorization.data.accessGrantId ||
      !authorization.data.actorId
    ) {
      return {
        ready: false,
        approvalCount: authorization.data.approvalCount,
        assignedReviewerMustReauthorize: authorization.data.approvalCount >= 2,
      };
    }
    const identityReview = await import(
      "@/infrastructure/security/identity-review"
    );
    return {
      ready: true,
      approvalCount: authorization.data.approvalCount,
      identity: await identityReview.readSubmittedIdentityForReview({
        accessGrantId: authorization.data.accessGrantId,
        caseId,
        actorId: authorization.data.actorId,
      }),
    };
  });
}
