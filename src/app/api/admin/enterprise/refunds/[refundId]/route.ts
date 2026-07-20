import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EcpayInvoiceError,
  getEcpayInvoiceClient,
  isAmbiguousEcpayAllowanceError,
} from "@/lib/ecpay-invoice";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import { appOrigin } from "@/lib/env";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    decision: z.literal("rejected"),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    decision: z.literal("paid"),
    reason: z.string().trim().min(5).max(500),
    providerRefundId: z.string().trim().min(3).max(100),
  }),
  z.object({
    decision: z.literal("retry_allowance"),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    decision: z.literal("reconcile_allowance_not_issued"),
    reason: z.string().trim().min(5).max(500),
    evidence: z.string().trim().min(3).max(500),
  }),
  z.object({
    decision: z.literal("reconcile_allowance_issued"),
    reason: z.string().trim().min(5).max(500),
    evidence: z.string().trim().min(3).max(500),
    invoiceNumber: z.string().trim().regex(/^[A-Z]{2}\d{8}$/),
    allowanceNumber: z.string().trim().regex(/^\d{16}$/),
    allowanceAt: z.string().datetime(),
    remainingAmountTwd: z.number().int().min(0),
  }),
]);

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ refundId: string }> },
) {
  const { refundId } = await params;
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(refundId).success || !parsed.success)
    return NextResponse.json({ error: "INVALID_REFUND_DECISION" }, { status: 400 });
  const actorId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!actorId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  // 財務操作不可只信任可能尚未刷新的 JWT app_metadata；在任何
  // service-role 資料讀取前，以 Auth Admin 的最新資料重新授權。
  const { data: authoritativeActor, error: actorLookupError } =
    await admin.auth.admin.getUserById(actorId);
  if (
    actorLookupError ||
    authoritativeActor.user?.app_metadata?.platform_role !== "admin"
  )
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: refund } = await admin
    .from("refunds")
    .select(
      "id,order_id,organization_id,seat_lot_id,seat_quantity,unit_price_twd,amount_twd,reason,status,provider_refund_id,refund_scope,organizations(name,invoice_email)",
    )
    .eq("id", refundId)
    .maybeSingle();
  if (!refund || refund.refund_scope !== "enterprise_seats")
    return NextResponse.json({ error: "REFUND_NOT_FOUND" }, { status: 404 });

  if (
    parsed.data.decision === "reconcile_allowance_not_issued" ||
    parsed.data.decision === "reconcile_allowance_issued"
  ) {
    const { data: allowanceRecord } = await admin
      .from("invoice_records")
      .select("id")
      .eq("refund_id", refund.id)
      .eq("record_type", "allowance")
      .maybeSingle();
    if (!allowanceRecord)
      return NextResponse.json(
        { error: "ALLOWANCE_RECORD_NOT_FOUND" },
        { status: 404 },
      );
    const reconciliation = parsed.data;
    const confirmedIssued =
      reconciliation.decision === "reconcile_allowance_issued";
    const { data, error } = await admin.rpc(
      "reconcile_enterprise_allowance",
      {
        target_invoice_record_id: allowanceRecord.id,
        target_actor_id: actorId,
        target_outcome: confirmedIssued
          ? "confirmed_issued"
          : "confirmed_not_issued",
        target_reason: reconciliation.reason,
        target_invoice_number:
          reconciliation.decision === "reconcile_allowance_issued"
            ? reconciliation.invoiceNumber
            : null,
        target_allowance_number:
          reconciliation.decision === "reconcile_allowance_issued"
            ? reconciliation.allowanceNumber
            : null,
        target_allowance_at:
          reconciliation.decision === "reconcile_allowance_issued"
            ? reconciliation.allowanceAt
            : null,
        target_remaining_allowance_twd:
          reconciliation.decision === "reconcile_allowance_issued"
            ? reconciliation.remainingAmountTwd
            : null,
        target_provider_response: {
          source: "manual_ecpay_reconciliation",
          evidence: reconciliation.evidence,
        },
      },
    );
    if (error)
      return NextResponse.json(
        {
          error: error.message.includes("NOT_RECONCILABLE")
            ? "ALLOWANCE_NOT_RECONCILABLE"
            : error.message.includes("MISMATCH")
              ? "ALLOWANCE_RECONCILIATION_MISMATCH"
              : "ALLOWANCE_RECONCILIATION_FAILED",
          message: error.message,
        },
        { status: 409 },
      );
    return NextResponse.json({ allowance: data });
  }

  if (
    parsed.data.decision === "approved" ||
    parsed.data.decision === "rejected"
  ) {
    const { data: decided, error } = await admin.rpc(
      "decide_enterprise_refund",
      {
        target_refund_id: refund.id,
        target_actor_id: actorId,
        target_decision: parsed.data.decision,
        target_reason: parsed.data.reason,
      },
    );
    if (error || !decided) {
      const decisionError = error?.message ?? "REFUND_DECISION_EMPTY_RESULT";
      const status = decisionError.includes("ALREADY_DECIDED")
        ? 409
        : decisionError.includes("NOT_FOUND")
          ? 404
          : decisionError.includes("PLATFORM_ADMIN_REQUIRED")
            ? 403
            : 500;
      return NextResponse.json(
        {
          error: decisionError.includes("ALREADY_DECIDED")
            ? "REFUND_ALREADY_DECIDED"
            : decisionError.includes("NOT_FOUND")
              ? "REFUND_NOT_FOUND"
              : "REFUND_DECISION_FAILED",
          message: error?.message,
        },
        { status },
      );
    }
    if (parsed.data.decision === "rejected") {
      const organization = relation(refund.organizations);
      if (organization?.invoice_email)
        await sendEnterpriseEmail({
          kind: "refund",
          refundDecision: "rejected",
          to: organization.invoice_email,
          organizationId: refund.organization_id,
          referenceId: `${refund.id}:rejected`,
          organizationName: organization.name,
          amountTwd: refund.amount_twd,
          reason: parsed.data.reason,
          request,
        }).catch(() => undefined);
    }
    return NextResponse.json({ refund: decided, status: parsed.data.decision });
  }

  let applied = refund;
  if (parsed.data.decision === "paid") {
    if (
      refund.status === "paid" &&
      refund.provider_refund_id !== parsed.data.providerRefundId
    )
      return NextResponse.json(
        { error: "PROVIDER_REFUND_ID_MISMATCH" },
        { status: 409 },
      );
    if (refund.status !== "approved" && refund.status !== "paid")
      return NextResponse.json(
        { error: "REFUND_MUST_BE_APPROVED" },
        { status: 409 },
      );
    if (refund.status === "approved") {
      const { data: originalInvoice } = await admin
        .from("invoice_records")
        .select("id,status")
        .eq("order_id", refund.order_id)
        .eq("record_type", "invoice")
        .maybeSingle();
      if (originalInvoice?.status !== "issued")
        return NextResponse.json(
          { error: "ISSUED_INVOICE_REQUIRED_BEFORE_REFUND" },
          { status: 409 },
        );
      const { data, error: applyError } = await admin.rpc(
        "apply_enterprise_refund",
        {
          target_refund_id: refund.id,
          target_actor_id: actorId,
          target_provider_refund_id: parsed.data.providerRefundId,
          target_decision_reason: parsed.data.reason,
        },
      );
      if (applyError)
        return NextResponse.json(
          {
            error: applyError.message.includes("INSUFFICIENT_UNUSED")
              ? "SEATS_ARE_NO_LONGER_REFUNDABLE"
              : "REFUND_APPLY_FAILED",
          },
          { status: 409 },
        );
      applied = data ?? refund;
    }
  } else if (refund.status !== "paid") {
    return NextResponse.json(
      { error: "REFUND_MUST_BE_PAID_BEFORE_ALLOWANCE_RETRY" },
      { status: 409 },
    );
  }

  const { data: allowanceRecord } = await admin
    .from("invoice_records")
    .select(
      "id,parent_invoice_id,order_id,buyer_title,buyer_email,amount_twd,allowance_status,allowance_manual_reconciliation_required",
    )
    .eq("refund_id", refund.id)
    .eq("record_type", "allowance")
    .maybeSingle();
  if (allowanceRecord?.allowance_status === "issued")
    return NextResponse.json({ error: "ALLOWANCE_ALREADY_ISSUED" }, { status: 409 });
  if (allowanceRecord?.allowance_status === "pending_consent")
    return NextResponse.json(
      { error: "ALLOWANCE_CONSENT_STILL_PENDING" },
      { status: 409 },
    );
  if (
    allowanceRecord?.allowance_status === "ambiguous" ||
    allowanceRecord?.allowance_manual_reconciliation_required
  )
    return NextResponse.json(
      { error: "ALLOWANCE_MANUAL_RECONCILIATION_REQUIRED" },
      { status: 409 },
    );
  let allowance = { started: false, reason: "INVOICE_NOT_ISSUED" } as {
    started: boolean;
    reason?: string;
    manualReconciliation?: boolean;
  };
  const [{ data: parent }, { data: orderItems }] = allowanceRecord
    ? await Promise.all([
        admin
          .from("invoice_records")
          .select("invoice_number,invoice_date")
          .eq("id", allowanceRecord.parent_invoice_id)
          .eq("record_type", "invoice")
          .maybeSingle(),
        admin
          .from("order_items")
          .select("quantity,unit_price_twd,courses(title)")
          .eq("order_id", allowanceRecord.order_id),
      ])
    : [{ data: null }, { data: [] }];
  const item = orderItems?.find((candidate) => {
    const course = relation(candidate.courses);
    return Boolean(course?.title);
  });
  const course = relation(item?.courses);
  if (allowanceRecord) {
    const { data: claimResult, error: claimError } = await admin.rpc(
      "claim_enterprise_allowance",
      {
        target_invoice_record_id: allowanceRecord.id,
        target_actor_id: actorId,
      },
    );
    const claim = Array.isArray(claimResult) ? claimResult[0] : claimResult;
    if (claimError || !claim?.allowance_claim_token) {
      allowance = {
        started: false,
        reason: claimError?.message.includes("RETRY_NOT_DUE")
          ? "ALLOWANCE_RETRY_NOT_DUE"
          : claimError?.message.includes("NOT_CLAIMABLE")
            ? "ALLOWANCE_ALREADY_PROCESSING"
            : "ALLOWANCE_CLAIM_FAILED",
      };
    } else {
      let providerRequestStarted = false;
      try {
        if (
          !parent?.invoice_number ||
          !parent.invoice_date ||
          !item ||
          !course
        )
          throw new EcpayInvoiceError(
            "INVALID_INPUT",
            "Allowance invoice or order item snapshot is incomplete.",
          );
        // 工廠可能回傳 null，也可能因 key/IV 長度錯誤直接 throw；一定要在
        // claim 後的 try/catch 內處理，讓 fail RPC 將 none/processing 轉為
        // retryable failed 並留下 audit，而不是靜默卡死。
        const client = getEcpayInvoiceClient();
        if (!client)
          throw new EcpayInvoiceError(
            "INVALID_CONFIGURATION",
            "ECPay invoice allowance service is not configured.",
          );
        const returnUrl = `${appOrigin(request)}/api/webhooks/ecpay/invoice-allowance?record=${encodeURIComponent(allowanceRecord.id)}`;
        providerRequestStarted = true;
        const result = await client.createAllowance({
          invoiceNumber: parent.invoice_number,
          invoiceDate: String(parent.invoice_date).slice(0, 10),
          customerName: allowanceRecord.buyer_title,
          customerEmail: allowanceRecord.buyer_email,
          allowanceAmountTwd: allowanceRecord.amount_twd,
          reason: refund.reason,
          items: [
            {
              name: `${course.title}企業培訓名額退費`,
              count: refund.seat_quantity,
              unitPriceTwd: refund.unit_price_twd,
              amountTwd: refund.amount_twd,
            },
          ],
          returnUrl,
        });
        const expiresAt = new Date(
          `${result.expiresAt.replace(" ", "T")}+08:00`,
        );
        if (Number.isNaN(expiresAt.getTime()))
          throw new EcpayInvoiceError(
            "INVALID_RESPONSE",
            "ECPay allowance expiry was invalid.",
          );
        const { error: completeError } = await admin.rpc(
          "complete_enterprise_allowance",
          {
            target_invoice_record_id: allowanceRecord.id,
            target_claim_token: claim.allowance_claim_token,
            target_actor_id: actorId,
            target_allowance_number: result.temporaryAllowanceNumber,
            target_allowance_expires_at: expiresAt.toISOString(),
            target_provider_response: result,
          },
        );
        if (completeError) {
          const { error: failError } = await admin.rpc(
            "fail_enterprise_allowance",
            {
              target_invoice_record_id: allowanceRecord.id,
              target_claim_token: claim.allowance_claim_token,
              target_actor_id: actorId,
              target_error_message:
                "ALLOWANCE_PROVIDER_ACCEPTED_RECORD_FAILED",
              target_ambiguous: true,
              target_provider_response: result,
            },
          );
          allowance = {
            started: false,
            reason: failError
              ? "ALLOWANCE_STATE_PERSIST_FAILED"
              : "ALLOWANCE_MANUAL_RECONCILIATION_REQUIRED",
            manualReconciliation: !failError,
          };
        } else allowance = { started: true };
      } catch (error) {
        const ambiguous =
          providerRequestStarted && isAmbiguousEcpayAllowanceError(error);
        const providerFailure = {
          name: error instanceof Error ? error.name : "UnknownError",
          code: error instanceof EcpayInvoiceError ? error.code : "UNKNOWN",
        };
        const { error: failError } = await admin.rpc(
          "fail_enterprise_allowance",
          {
            target_invoice_record_id: allowanceRecord.id,
            target_claim_token: claim.allowance_claim_token,
            target_actor_id: actorId,
            target_error_message: ambiguous
              ? "ALLOWANCE_PROVIDER_RESULT_AMBIGUOUS"
              : "ALLOWANCE_PROVIDER_REJECTED",
            target_ambiguous: ambiguous,
            target_provider_response: providerFailure,
          },
        );
        allowance = {
          started: false,
          reason: failError
            ? "ALLOWANCE_STATE_PERSIST_FAILED"
            : ambiguous
              ? "ALLOWANCE_MANUAL_RECONCILIATION_REQUIRED"
              : "ALLOWANCE_RETRY_SCHEDULED",
          manualReconciliation: !failError && ambiguous,
        };
      }
    }
  }

  const organization = relation(refund.organizations);
  if (parsed.data.decision === "paid" && organization?.invoice_email)
    await sendEnterpriseEmail({
      kind: "refund",
      refundDecision: "paid",
      to: organization.invoice_email,
      organizationId: refund.organization_id,
      referenceId: `${refund.id}:paid`,
      organizationName: organization.name,
      amountTwd: refund.amount_twd,
      reason: parsed.data.reason,
      request,
    }).catch(() => undefined);
  if (!allowance.started)
    return NextResponse.json(
      {
        error: allowance.reason ?? "ALLOWANCE_NOT_STARTED",
        refund: applied,
        allowance,
      },
      {
        status:
          allowance.manualReconciliation ||
          allowance.reason === "ALLOWANCE_RETRY_NOT_DUE" ||
          allowance.reason === "ALLOWANCE_ALREADY_PROCESSING"
            ? 409
            : 503,
      },
    );
  return NextResponse.json({ refund: applied, allowance });
}
