import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ organizationId: string; invitationId: string }>;
  },
) {
  return mutation(request, async () => {
    const { organizationId, invitationId } = await context.params;
    z.uuid().parse(organizationId);
    z.uuid().parse(invitationId);
    const { operation } = await readJson(
      request,
      z.object({ operation: z.enum(["resend", "revoke"]) }),
    );
    const { supabase } = await requireUser();
    let tokenHash: string | null = null;
    if (operation === "resend") {
      const { data, error } = await serviceSupabase()
        .from("organization_invitations")
        .select("token_hash")
        .eq("id", invitationId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error || !data?.token_hash) {
        throw new Error("ORGANIZATION_INVITATION_RESEND_REJECTED");
      }
      tokenHash = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(data.token_hash);
    }
    const { data, error } = await supabase.rpc(
      "manage_organization_invitation",
      {
        p_organization_id: organizationId,
        p_invitation_id: invitationId,
        p_operation: operation,
        p_token_hash: tokenHash,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) {
      throw new Error("ORGANIZATION_INVITATION_ACTION_REJECTED");
    }
    return data;
  });
}
