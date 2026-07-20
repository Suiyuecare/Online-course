import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canEditOrganization,
  isEnterpriseEnabled,
  normalizeTaxId,
} from "@/lib/enterprise-core";
import { isValidTaiwanBusinessNumber } from "@/lib/ecpay-invoice-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
  organizationContextForClient,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const applicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  taxId: z
    .string()
    .transform(normalizeTaxId)
    .pipe(z.string().length(8).refine(isValidTaiwanBusinessNumber)),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().min(8).max(30),
  invoiceEmail: z.string().trim().email().max(80),
});
const updateSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().min(8).max(30),
  invoiceEmail: z.string().trim().email().max(80),
});

function disabled() {
  return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
}

export async function GET() {
  if (!isEnterpriseEnabled()) return disabled();
  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const context = await getOrganizationContext(admin, identity.id);
  return NextResponse.json({
    context: context ? organizationContextForClient(context) : null,
  });
}

export async function POST(request: Request) {
  if (!isEnterpriseEnabled()) return disabled();
  const parsed = applicationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_APPLICATION" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  if (await getOrganizationContext(admin, identity.id))
    return NextResponse.json(
      { error: "ORGANIZATION_MEMBERSHIP_EXISTS" },
      { status: 409 },
    );
  const { data: existing } = await admin
    .from("organizations")
    .select("id,status")
    .eq("tax_id", parsed.data.taxId)
    .maybeSingle();
  if (existing)
    return NextResponse.json(
      {
        error: "TAX_ID_ALREADY_EXISTS",
        message: "此統編已建立機構，請由既有管理者邀請或聯絡客服。",
      },
      { status: 409 },
    );
  const { data, error } = await admin.rpc("submit_organization_application", {
    target_actor_id: identity.id,
    target_name: parsed.data.name,
    target_tax_id: parsed.data.taxId,
    target_contact_name: parsed.data.contactName,
    target_contact_phone: parsed.data.contactPhone,
    target_invoice_email: parsed.data.invoiceEmail.toLowerCase(),
  });
  if (error)
    return NextResponse.json(
      { error: "APPLICATION_FAILED", message: error.message },
      { status: 409 },
    );
  return NextResponse.json({ organization: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isEnterpriseEnabled()) return disabled();
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });
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
  if (!context || !canEditOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const organizationUpdate = {
    name: parsed.data.name,
    contact_name: parsed.data.contactName,
    contact_phone: parsed.data.contactPhone,
    invoice_email: parsed.data.invoiceEmail.toLowerCase(),
  };
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "organization.update_requested",
    target_type: "organization",
    target_id: context.organizationId,
    before_data: {
      name: context.organization.name,
      invoice_email: context.organization.invoice_email,
    },
    after_data: organizationUpdate,
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "ORGANIZATION_AUDIT_FAILED" },
      { status: 503 },
    );
  const { data: updated, error } = await admin
    .from("organizations")
    .update(organizationUpdate)
    .eq("id", context.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !updated)
    return NextResponse.json(
      { error: error ? "UPDATE_FAILED" : "ORGANIZATION_CHANGED" },
      { status: error ? 500 : 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "organization.updated",
    target_type: "organization",
    target_id: context.organizationId,
    after_data: {
      name: parsed.data.name,
      invoice_email: parsed.data.invoiceEmail.toLowerCase(),
    },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "ORGANIZATION_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  return NextResponse.json({ ok: true });
}
