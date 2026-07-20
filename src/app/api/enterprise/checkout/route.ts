import { NextResponse } from "next/server";
import { z } from "zod";
import {
  calculateEnterpriseOrder,
  canManageOrganization,
  isEnterpriseEnabled,
  normalizeTaxId,
  type PriceTier,
} from "@/lib/enterprise-core";
import { getAuthenticatedIdentity, getOrganizationContext } from "@/lib/enterprise";
import { appOrigin } from "@/lib/env";
import {
  configuredEcpayCheckoutUrl,
  createCheckMacValue,
  createMerchantTradeNo,
  taipeiTradeDate,
} from "@/lib/ecpay";
import { isValidTaiwanBusinessNumber } from "@/lib/ecpay-invoice-core";
import { isEcpayInvoiceConfigured } from "@/lib/ecpay-invoice";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const schema = z.object({
  organizationId: z.string().uuid(),
  courseId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  invoiceTitle: z.string().trim().min(2).max(60),
  invoiceTaxId: z
    .string()
    .transform(normalizeTaxId)
    .pipe(z.string().length(8).refine(isValidTaiwanBusinessNumber)),
  invoiceEmail: z.string().trim().email().max(80),
  idempotencyKey: z.string().uuid(),
});
const ENTERPRISE_QUOTE_TTL_MS = 15 * 60_000;

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_CHECKOUT" }, { status: 400 });
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;
  const checkoutUrl = configuredEcpayCheckoutUrl();
  const client = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(client);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const invoiceConfigured = isEcpayInvoiceConfigured();
  if (
    !merchantId ||
    !hashKey ||
    !hashIv ||
    !checkoutUrl ||
    !admin ||
    !invoiceConfigured
  )
    return NextResponse.json(
      {
        error: invoiceConfigured
          ? "PAYMENT_NOT_CONFIGURED"
          : "INVOICE_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  const context = await getOrganizationContext(
    admin,
    identity.id,
    parsed.data.organizationId,
  );
  if (
    !context ||
    !canManageOrganization(context.role) ||
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json({ error: "ORGANIZATION_NOT_APPROVED" }, { status: 403 });
  if (context.organization.tax_id !== parsed.data.invoiceTaxId)
    return NextResponse.json(
      { error: "INVOICE_TAX_ID_MISMATCH" },
      { status: 409 },
    );
  const [{ data: course }, { data: tiers }, { data: previous }] = await Promise.all([
    admin
      .from("courses")
      .select("id,title,delivery,status")
      .eq("id", parsed.data.courseId)
      .maybeSingle(),
    admin
      .from("course_price_tiers")
      .select(
        "id,min_quantity,max_quantity,unit_price_twd,effective_at,expires_at,active",
      )
      .eq("course_id", parsed.data.courseId)
      .eq("active", true),
    admin
      .from("orders")
      .select(
        "id,amount_twd,status,created_at,invoice_title,invoice_tax_id,invoice_email,pricing_tier_id,order_items(course_id,item_type,quantity,unit_price_twd,pricing_tier_id)",
      )
      .eq("checkout_idempotency_key", parsed.data.idempotencyKey)
      .eq("buyer_id", identity.id)
      .eq("organization_id", context.organizationId)
      .maybeSingle(),
  ]);
  if (
    !course ||
    course.status !== "published" ||
    !["recorded", "live"].includes(course.delivery)
  )
    return NextResponse.json({ error: "COURSE_NOT_FOR_ENTERPRISE" }, { status: 409 });
  if (
    course.delivery === "live" &&
    process.env.FEATURE_LIVE_COURSES !== "true"
  )
    return NextResponse.json(
      { error: "LIVE_COURSES_DISABLED" },
      { status: 409 },
    );
  const previousItem = previous?.order_items?.find(
    (item) => item.item_type === "seat_pack",
  );
  if (
    previous?.status === "pending" &&
    Date.parse(previous.created_at) < Date.now() - ENTERPRISE_QUOTE_TTL_MS
  )
    return NextResponse.json(
      { error: "CHECKOUT_QUOTE_EXPIRED" },
      { status: 409 },
    );
  if (
    previous &&
    (!previousItem ||
      previous.order_items.length !== 1 ||
      previousItem.course_id !== parsed.data.courseId ||
      previousItem.quantity !== parsed.data.quantity ||
      !previousItem.pricing_tier_id ||
      previous.pricing_tier_id !== previousItem.pricing_tier_id ||
      previous.invoice_title !== parsed.data.invoiceTitle ||
      previous.invoice_tax_id !== parsed.data.invoiceTaxId ||
      previous.invoice_email !== parsed.data.invoiceEmail.toLowerCase() ||
      previous.amount_twd !==
        previousItem.quantity * previousItem.unit_price_twd)
  )
    return NextResponse.json(
      { error: "IDEMPOTENCY_SNAPSHOT_MISMATCH" },
      { status: 409 },
    );
  const pricing = previousItem
    ? {
        tier: { id: previousItem.pricing_tier_id },
        quantity: previousItem.quantity,
        unitPriceTwd: previousItem.unit_price_twd,
        totalAmountTwd:
          previous?.amount_twd ??
          previousItem.quantity * previousItem.unit_price_twd,
      }
    : calculateEnterpriseOrder(
        (tiers ?? []) as PriceTier[],
        parsed.data.quantity,
      );
  if (!pricing || pricing.totalAmountTwd > 5_000_000)
    return NextResponse.json({ error: "PRICE_TIER_NOT_AVAILABLE" }, { status: 409 });
  const { data: orderResult, error: orderError } = await admin.rpc(
    "create_enterprise_checkout_order",
    {
      target_buyer_id: identity.id,
      target_organization_id: context.organizationId,
      target_course_id: course.id,
      target_quantity: pricing.quantity,
      target_pricing_tier_id: pricing.tier.id,
      target_invoice_title: parsed.data.invoiceTitle,
      target_invoice_tax_id: parsed.data.invoiceTaxId,
      target_invoice_email: parsed.data.invoiceEmail.toLowerCase(),
      target_checkout_idempotency_key: parsed.data.idempotencyKey,
      target_merchant_trade_no: createMerchantTradeNo(),
    },
  );
  if (orderError) {
    const idempotencyError = orderError.message.includes("IDEMPOTENCY");
    const forbiddenError = orderError.message.includes("MANAGER_REQUIRED");
    const businessConflict =
      idempotencyError ||
      orderError.message.includes("ORGANIZATION_NOT_ACTIVE") ||
      orderError.message.includes("PRICE_TIER") ||
      orderError.message.includes("TAX_ID_MISMATCH") ||
      orderError.message.includes("COURSE_NOT_FOR_ENTERPRISE");
    return NextResponse.json(
      {
        error: idempotencyError
          ? "IDEMPOTENCY_SNAPSHOT_MISMATCH"
          : orderError.message.includes("ORGANIZATION_NOT_ACTIVE")
            ? "ORGANIZATION_NOT_APPROVED"
            : orderError.message.includes("PRICE_TIER")
              ? "PRICE_TIER_NOT_AVAILABLE"
              : forbiddenError
                ? "FORBIDDEN"
              : "ORDER_CREATE_FAILED",
      },
      { status: forbiddenError ? 403 : businessConflict ? 409 : 500 },
    );
  }
  const order = Array.isArray(orderResult) ? orderResult[0] : orderResult;
  if (!order?.id || !order.merchant_trade_no)
    return NextResponse.json({ error: "ORDER_CREATE_FAILED" }, { status: 500 });
  if (order.amount_twd !== pricing.totalAmountTwd)
    return NextResponse.json({ error: "IDEMPOTENCY_AMOUNT_MISMATCH" }, { status: 409 });
  if (order.status === "paid")
    return NextResponse.json({ error: "ORDER_ALREADY_PAID" }, { status: 409 });
  if (order.status !== "pending")
    return NextResponse.json({ error: "ORDER_NOT_PAYABLE" }, { status: 409 });
  const origin = appOrigin(request);
  const fields: Record<string, string> = {
    MerchantID: merchantId,
    MerchantTradeNo: order.merchant_trade_no,
    MerchantTradeDate: taipeiTradeDate(),
    PaymentType: "aio",
    TotalAmount: String(order.amount_twd),
    TradeDesc: "SuiyueAcademyEnterpriseSeats",
    ItemName: `${course.title} x ${pricing.quantity}`
      .replace(/[#$&+<=>?@]/g, " ")
      .slice(0, 200),
    ReturnURL: `${origin}/api/webhooks/ecpay`,
    OrderResultURL: `${origin}/api/payments/ecpay/result`,
    ClientBackURL: `${origin}/checkout/result?order=${encodeURIComponent(order.merchant_trade_no)}`,
    ChoosePayment: "Credit",
    EncryptType: "1",
    NeedExtraPaidInfo: "Y",
  };
  fields.CheckMacValue = createCheckMacValue(fields, hashKey, hashIv);
  return NextResponse.json(
    { action: checkoutUrl, fields },
    { headers: { "cache-control": "no-store" } },
  );
}
