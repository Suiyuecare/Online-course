import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import {
  invitationPhoneIndex,
  invitationTokenHash,
} from "@/infrastructure/security/organization-invitations";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const { token } = await readJson(
      request,
      z.object({ token: z.string().min(40).max(60) }),
    );
    const { supabase, user } = await requireUser();
    if (!user.phone) throw new Error("PHONE_IDENTITY_REQUIRED");
    const { data, error } = await supabase.rpc(
      "accept_organization_invitation",
      {
        p_token_hash: invitationTokenHash(token),
        p_authenticated_phone_blind_index: invitationPhoneIndex(user.phone),
      },
    );
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
