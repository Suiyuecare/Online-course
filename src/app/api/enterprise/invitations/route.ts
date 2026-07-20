import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/env";
import {
  canManageOrganization,
  createInvitationToken,
  hashInvitationToken,
  isEnterpriseEnabled,
  normalizeEmail,
} from "@/lib/enterprise-core";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().max(100).optional().default(""),
  employeeCode: z.string().trim().max(60).optional().default(""),
  department: z.string().trim().max(100).optional().default(""),
  role: z.enum(["member", "manager"]).default("member"),
});
const actionSchema = z.object({
  organizationId: z.string().uuid(),
  invitationId: z.string().uuid(),
  action: z.enum(["revoke", "resend"]),
});

async function actorContext(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity || !admin) return { identity, admin, context: null };
  return {
    identity,
    admin,
    context: await getOrganizationContext(
      admin,
      identity.id,
      organizationId,
    ),
  };
}

export async function GET(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  if (!z.string().uuid().safeParse(organizationId).success)
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });
  const { identity, admin, context } = await actorContext(organizationId!);
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const { data } = await admin
    .from("organization_invitations")
    .select(
      "id,email,invitee_name,employee_code,department,role,status,expires_at,accepted_at,created_at",
    )
    .eq("organization_id", organizationId!)
    .order("created_at", { ascending: false });
  return NextResponse.json({ invitations: data ?? [] });
}

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_INVITATION" }, { status: 400 });
  const { identity, admin, context } = await actorContext(
    parsed.data.organizationId,
  );
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (
    !context ||
    !canManageOrganization(context.role) ||
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (parsed.data.role === "manager" && context.role !== "owner")
    return NextResponse.json(
      { error: "OWNER_REQUIRED_FOR_MANAGER_INVITE" },
      { status: 403 },
    );
  const email = normalizeEmail(parsed.data.email);
  const { data: existingInvitation } = await admin
    .from("organization_invitations")
    .select("id,status,role")
    .eq("organization_id", parsed.data.organizationId)
    .eq("email", email)
    .maybeSingle();
  if (existingInvitation?.status === "accepted")
    return NextResponse.json(
      { error: "ALREADY_ORGANIZATION_MEMBER" },
      { status: 409 },
    );
  if (existingInvitation?.role === "manager" && context.role !== "owner")
    return NextResponse.json(
      { error: "OWNER_REQUIRED_FOR_MANAGER_INVITE" },
      { status: 403 },
    );
  const token = createInvitationToken();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const invitationPayload = {
        organization_id: parsed.data.organizationId,
        email,
        invitee_name: parsed.data.fullName,
        employee_code: parsed.data.employeeCode || null,
        department: parsed.data.department || null,
        role: parsed.data.role,
        status: "pending",
        token_hash: hashInvitationToken(token),
        expires_at: expiresAt,
        invited_by: identity.id,
        revoked_at: null,
        accepted_at: null,
      };
  const mutation = existingInvitation
    ? admin
        .from("organization_invitations")
        .update(invitationPayload)
        .eq("id", existingInvitation.id)
        .eq("role", existingInvitation.role)
        .neq("status", "accepted")
    : admin.from("organization_invitations").insert(invitationPayload);
  const { data, error } = await mutation
    .select("id,email,invitee_name,role,status,expires_at")
    .single();
  if (error)
    return NextResponse.json(
      { error: "INVITATION_FAILED", message: error.message },
      { status: 409 },
    );
  const inviteUrl = `${appOrigin(request)}/enterprise/invite/${encodeURIComponent(token)}`;
  const { error: auditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: existingInvitation
      ? "enterprise.invitation_reissued"
      : "enterprise.invitation_created",
    target_type: "organization_invitation",
    target_id: data.id,
    after_data: {
      role: data.role,
      status: data.status,
      expires_at: data.expires_at,
    },
  });
  if (auditError)
    return NextResponse.json(
      { error: "INVITATION_AUDIT_FAILED" },
      { status: 503 },
    );
  const delivery = await sendEnterpriseEmail({
    kind: "invitation",
    to: email,
    organizationId: context.organizationId,
    referenceId: data.id,
    organizationName: context.organization.name,
    learnerName: parsed.data.fullName || undefined,
    inviteUrl,
    request,
  }).catch(() => ({ sent: false as const, reason: "EMAIL_SEND_FAILED" }));
  return NextResponse.json(
    {
      invitation: data,
      emailSent: delivery.sent,
      emailPending: !delivery.sent,
      deliveryReason: delivery.sent ? undefined : delivery.reason,
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  const { identity, admin, context } = await actorContext(
    parsed.data.organizationId,
  );
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const { data: invitation } = await admin
    .from("organization_invitations")
    .select("id,email,invitee_name,status,role")
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (!invitation)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (invitation.role === "manager" && context.role !== "owner")
    return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 403 });
  if (parsed.data.action === "revoke") {
    if (invitation.status !== "pending")
      return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
    const { error: requestAuditError } = await admin
      .from("audit_events")
      .insert({
        actor_id: identity.id,
        organization_id: context.organizationId,
        action: "enterprise.invitation_revoke_requested",
        target_type: "organization_invitation",
        target_id: invitation.id,
        before_data: { status: invitation.status },
        after_data: { status: "revoked" },
      });
    if (requestAuditError)
      return NextResponse.json(
        { error: "INVITATION_AUDIT_FAILED" },
        { status: 503 },
      );
    const { data: revoked, error } = await admin
      .from("organization_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !revoked)
      return NextResponse.json(
        { error: error ? "INVITATION_REVOKE_FAILED" : "INVITATION_CHANGED" },
        { status: error ? 500 : 409 },
      );
    const { error: resultAuditError } = await admin.from("audit_events").insert({
      actor_id: identity.id,
      organization_id: context.organizationId,
      action: "enterprise.invitation_revoked",
      target_type: "organization_invitation",
      target_id: invitation.id,
      before_data: { status: invitation.status },
      after_data: { status: "revoked" },
    });
    if (resultAuditError)
      return NextResponse.json(
        { error: "INVITATION_RESULT_AUDIT_FAILED" },
        { status: 503 },
      );
    return NextResponse.json({ ok: true });
  }
  if (invitation.status === "accepted")
    return NextResponse.json({ error: "ALREADY_ACCEPTED" }, { status: 409 });
  const token = createInvitationToken();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "enterprise.invitation_resend_requested",
    target_type: "organization_invitation",
    target_id: invitation.id,
    before_data: { status: invitation.status },
    after_data: { status: "pending", expires_at: expiresAt },
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "INVITATION_AUDIT_FAILED" },
      { status: 503 },
    );
  const { data: resent, error } = await admin
    .from("organization_invitations")
    .update({
      status: "pending",
      token_hash: hashInvitationToken(token),
      expires_at: expiresAt,
      revoked_at: null,
    })
    .eq("id", invitation.id)
    .eq("status", invitation.status)
    .neq("status", "accepted")
    .select("id")
    .maybeSingle();
  if (error || !resent)
    return NextResponse.json(
      { error: error ? "INVITATION_RESEND_FAILED" : "INVITATION_CHANGED" },
      { status: error ? 500 : 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "enterprise.invitation_resent",
    target_type: "organization_invitation",
    target_id: invitation.id,
    before_data: { status: invitation.status },
    after_data: { status: "pending", expires_at: expiresAt },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "INVITATION_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  const delivery = await sendEnterpriseEmail({
    kind: "invitation",
    to: invitation.email,
    organizationId: context.organizationId,
    referenceId: invitation.id,
    organizationName: context.organization.name,
    learnerName: invitation.invitee_name || undefined,
    inviteUrl: `${appOrigin(request)}/enterprise/invite/${encodeURIComponent(token)}`,
    request,
  }).catch(() => ({ sent: false as const, reason: "EMAIL_SEND_FAILED" }));
  return NextResponse.json({
    ok: true,
    expiresAt,
    emailSent: delivery.sent,
    emailPending: !delivery.sent,
  });
}
