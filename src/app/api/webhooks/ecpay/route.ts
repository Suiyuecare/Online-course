import { createHash } from "node:crypto";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyCheckMacValue } from "@/lib/ecpay";
import {
  ensureEnterpriseInvoiceRecord,
  retryEnterpriseInvoiceRecord,
} from "@/lib/ecpay-invoice";
import { sendLiveCourseEmailByOrder } from "@/lib/live-email";

function text(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;
  const admin = createSupabaseAdminClient();
  if (!hashKey || !hashIv || !admin)
    return text("0|SERVICE_NOT_CONFIGURED", 503);
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  if (!verifyCheckMacValue(params, hashKey, hashIv))
    return text("0|INVALID_CHECK_MAC", 403);
  const tradeNo = params.MerchantTradeNo;
  if (!tradeNo) return text("0|MISSING_TRADE_NO", 400);

  const eventKey = createHash("sha256")
    .update(
      `${tradeNo}|${params.TradeNo ?? ""}|${params.RtnCode ?? ""}|${params.PaymentDate ?? ""}`,
    )
    .digest("hex");
  const { data: order } = await admin
    .from("orders")
    .select("id,status,amount_twd,order_kind,organization_id")
    .eq("merchant_trade_no", tradeNo)
    .maybeSingle();
  if (!order) return text("0|ORDER_NOT_FOUND", 404);
  if (String(order.amount_twd) !== params.TradeAmt)
    return text("0|AMOUNT_MISMATCH", 400);

  if (params.RtnCode !== "1") {
    const { error: rejectedEventError } = await admin
      .from("payment_events")
      .upsert(
        {
          provider_event_key: eventKey,
          merchant_trade_no: tradeNo,
          event_type: "payment_rejected",
          verified: true,
          payload: params,
        },
        { onConflict: "provider_event_key", ignoreDuplicates: true },
      );
    if (rejectedEventError) return text("0|EVENT_PERSIST_FAILED", 500);
    return text("1|OK");
  }
  const { error } = await admin.rpc("apply_ecpay_paid_order", {
    target_trade_no: tradeNo,
    target_provider_trade_no: params.TradeNo ?? "",
    target_payment_type: params.PaymentType ?? "",
    target_message: params.RtnMsg ?? "",
    target_event_key: eventKey,
    target_payload: params,
  });
  if (error) return text("0|PROCESSING_FAILED", 500);
  after(async () => {
    if (
      order.order_kind === "enterprise_seat_pack" &&
      order.organization_id
    ) {
      const invoice = await ensureEnterpriseInvoiceRecord({
        organizationId: order.organization_id,
        orderId: order.id,
        amountTwd: order.amount_twd,
      });
      if (invoice.record?.id)
        await retryEnterpriseInvoiceRecord(invoice.record.id);
      return;
    }
    await sendLiveCourseEmailByOrder(
      order.id,
      "purchase_confirmation",
      request,
    );
  });
  return text("1|OK");
}
