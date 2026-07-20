import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
} from "@/lib/supabase/server";

const schema = z.object({
  decision: z.enum(["approved", "rejected", "suspended"]),
  reason: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const { organizationId } = await params;
  if (!z.string().uuid().safeParse(organizationId).success || !parsed.success)
    return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  if (
    parsed.data.decision !== "approved" &&
    (!parsed.data.reason || parsed.data.reason.length < 5)
  )
    return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  if (!admin || !actorId)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: currentActor } = await admin.auth.admin.getUserById(actorId);
  if (currentActor.user?.app_metadata?.platform_role !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: before } = await admin
    .from("organizations")
    .select("id,name,status,invoice_email,review_note")
    .eq("id", organizationId)
    .maybeSingle();
  if (!before)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: organizationId,
    action: "organization.review_requested",
    target_type: "organization",
    target_id: organizationId,
    before_data: { status: before.status },
    after_data: {
      status: parsed.data.decision,
      reason: parsed.data.reason ?? null,
    },
  });
  if (requestAuditError)
    return NextResponse.json({ error: "REVIEW_AUDIT_FAILED" }, { status: 503 });
  const reviewedAt = new Date().toISOString();
  const { data: reviewed, error } = await admin
    .from("organizations")
    .update({
      status: parsed.data.decision,
      active: parsed.data.decision === "approved",
      reviewed_at: reviewedAt,
      reviewed_by: actorId,
      review_note:
        parsed.data.decision === "approved" ? null : parsed.data.reason,
    })
    .eq("id", organizationId)
    .eq("status", before.status)
    .select("id")
    .maybeSingle();
  if (error || !reviewed)
    return NextResponse.json(
      { error: error ? "REVIEW_FAILED" : "ORGANIZATION_CHANGED" },
      { status: error ? 500 : 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: organizationId,
    action: `organization.${parsed.data.decision}`,
    target_type: "organization",
    target_id: organizationId,
    before_data: { status: before.status },
    after_data: {
      status: parsed.data.decision,
      reason: parsed.data.reason ?? null,
    },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "REVIEW_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  if (before.invoice_email)
    await sendEnterpriseEmail({
      kind: "organization_review",
      to: before.invoice_email,
      organizationId,
      referenceId: `${organizationId}:${reviewedAt}`,
      organizationName: before.name,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      request,
    }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
