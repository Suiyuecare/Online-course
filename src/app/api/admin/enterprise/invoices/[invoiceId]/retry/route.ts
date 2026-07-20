import { NextResponse } from "next/server";
import { z } from "zod";
import { retryEnterpriseInvoiceRecord } from "@/lib/ecpay-invoice";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
} from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { invoiceId } = await params;
  if (!z.string().uuid().safeParse(invoiceId).success)
    return NextResponse.json({ error: "INVALID_INVOICE" }, { status: 400 });
  const actorId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!actorId || !admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: currentActor, error: actorLookupError } =
    await admin.auth.admin.getUserById(actorId);
  if (
    actorLookupError ||
    currentActor.user?.app_metadata?.platform_role !== "admin"
  )
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: invoice } = await admin
    .from("invoice_records")
    .select("id,organization_id,record_type,status,attempt_count")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice || invoice.record_type !== "invoice")
    return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: invoice.organization_id,
    action: "enterprise.invoice_manual_retry_requested",
    target_type: "invoice_record",
    target_id: invoiceId,
    before_data: {
      status: invoice.status,
      attempt_count: invoice.attempt_count,
    },
    after_data: { retry_limit_override: invoice.attempt_count >= 5 },
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "INVOICE_RETRY_AUDIT_FAILED" },
      { status: 503 },
    );
  const result = await retryEnterpriseInvoiceRecord(invoiceId, {
    maxAttempts: Number.MAX_SAFE_INTEGER,
  });
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    organization_id: invoice.organization_id,
    action: result.issued
      ? "enterprise.invoice_retry_succeeded"
      : "enterprise.invoice_retry_failed",
    target_type: "invoice_record",
    target_id: invoiceId,
    after_data: result,
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "INVOICE_RETRY_RESULT_AUDIT_FAILED", result },
      { status: 503 },
    );
  return NextResponse.json(result, { status: result.issued ? 200 : 409 });
}
