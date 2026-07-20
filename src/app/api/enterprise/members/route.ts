import { NextResponse } from "next/server";
import { z } from "zod";
import { isEnterpriseEnabled } from "@/lib/enterprise-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const schema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["member", "manager"]),
});

export async function PATCH(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_MEMBER_UPDATE" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const context = await getOrganizationContext(
    admin,
    identity.id,
    parsed.data.organizationId,
  );
  if (!context || context.role !== "owner")
    return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const { data: member } = await admin
    .from("organization_members")
    .select("user_id,role")
    .eq("organization_id", context.organizationId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (!member)
    return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });
  if (member.role === "owner" || member.user_id === identity.id)
    return NextResponse.json({ error: "OWNER_CANNOT_BE_CHANGED" }, { status: 409 });
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "organization.member_role_update_requested",
    target_type: "organization_member",
    target_id: member.user_id,
    before_data: { role: member.role },
    after_data: { role: parsed.data.role },
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "MEMBER_AUDIT_FAILED" },
      { status: 503 },
    );
  const { data: updated, error } = await admin
    .from("organization_members")
    .update({ role: parsed.data.role })
    .eq("organization_id", context.organizationId)
    .eq("user_id", member.user_id)
    .eq("role", member.role)
    .neq("role", "owner")
    .select("user_id")
    .maybeSingle();
  if (error || !updated)
    return NextResponse.json(
      { error: error ? "MEMBER_UPDATE_FAILED" : "MEMBER_CHANGED" },
      { status: error ? 500 : 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "organization.member_role_updated",
    target_type: "organization_member",
    target_id: member.user_id,
    before_data: { role: member.role },
    after_data: { role: parsed.data.role },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "MEMBER_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  return NextResponse.json({ ok: true, role: parsed.data.role });
}
