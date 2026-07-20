import { NextResponse } from "next/server";
import { z } from "zod";
import {
  hashInvitationToken,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import { getAuthenticatedIdentity } from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const schema = z.object({ token: z.string().min(32).max(200) });

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_INVITATION" }, { status: 400 });
  const client = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(client);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data, error } = await admin.rpc("accept_organization_invitation", {
    target_token_hash: hashInvitationToken(parsed.data.token),
    target_actor_id: identity.id,
    target_actor_email: identity.email,
  });
  if (error)
    return NextResponse.json(
      {
        error: error.message.includes("EMAIL")
          ? "EMAIL_MISMATCH"
          : error.message.includes("EXPIRED")
            ? "INVITATION_EXPIRED"
            : "INVITATION_NOT_ACCEPTED",
        message: error.message,
      },
      { status: 409 },
    );
  return NextResponse.json({ membership: data });
}
