import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/env";
import {
  configuredEcpayCheckoutUrl,
  createCheckMacValue,
  createMerchantTradeNo,
  taipeiTradeDate,
} from "@/lib/ecpay";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const schema = z.object({
  courseSlug: z.string().min(1).max(120),
  liveSessionId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_CHECKOUT" }, { status: 400 });
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;
  const checkoutUrl = configuredEcpayCheckoutUrl();
  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  if (!merchantId || !hashKey || !hashIv || !checkoutUrl || !admin || !supabase)
    return NextResponse.json(
      {
        error: "PAYMENT_NOT_CONFIGURED",
        message: "測試金流或資料庫尚未設定。",
      },
      { status: 503 },
    );

  const { data: claims, error: authError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (authError || typeof userId !== "string")
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { data: course } = await admin
    .from("courses")
    .select("id,slug,title,price_twd,status,delivery")
    .eq("slug", parsed.data.courseSlug)
    .maybeSingle();
  if (!course || course.status !== "published")
    return NextResponse.json(
      { error: "COURSE_NOT_FOR_SALE", message: "課程影片尚未就緒或尚未發布。" },
      { status: 409 },
    );
  if (course.delivery === "live" && !parsed.data.liveSessionId)
    return NextResponse.json(
      { error: "LIVE_SESSION_REQUIRED", message: "請先選擇直播場次。" },
      { status: 400 },
    );
  if (course.delivery !== "live" && parsed.data.liveSessionId)
    return NextResponse.json(
      { error: "RECORDED_COURSE_HAS_NO_SESSION" },
      { status: 400 },
    );
  if (
    !Number.isInteger(course.price_twd) ||
    course.price_twd <= 0 ||
    course.price_twd > 20_000
  )
    return NextResponse.json(
      { error: "INVALID_COURSE_PRICE" },
      { status: 409 },
    );

  if (parsed.data.liveSessionId) {
    const { data: session } = await admin
      .from("live_sessions")
      .select("id,course_id,status,starts_at,capacity")
      .eq("id", parsed.data.liveSessionId)
      .maybeSingle();
    if (
      !session ||
      session.course_id !== course.id ||
      session.status !== "open" ||
      Date.parse(session.starts_at) <= Date.now()
    )
      return NextResponse.json(
        {
          error: "LIVE_SESSION_NOT_FOR_SALE",
          message: "此場次尚未開放、已開始或已取消。",
        },
        { status: 409 },
      );
  }
  let entitlementQuery = admin
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", course.id)
    .eq("active", true);
  entitlementQuery = parsed.data.liveSessionId
    ? entitlementQuery.eq("live_session_id", parsed.data.liveSessionId)
    : entitlementQuery.is("live_session_id", null);
  const { data: existingEntitlement } = await entitlementQuery.maybeSingle();
  if (existingEntitlement)
    return NextResponse.json(
      {
        error: "ALREADY_ENTITLED",
        redirectTo: parsed.data.liveSessionId
          ? `/live/${parsed.data.liveSessionId}`
          : `/learn/${course.slug}`,
      },
      { status: 409 },
    );
  const { data: existingOrder } = await admin
    .from("orders")
    .select(
      "id,merchant_trade_no,amount_twd,status,order_kind,order_items(course_id,live_session_id,item_type,quantity,unit_price_twd)",
    )
    .eq("checkout_idempotency_key", parsed.data.idempotencyKey)
    .eq("buyer_id", userId)
    .maybeSingle();

  const existingItem = existingOrder?.order_items?.find(
    (item) => item.item_type === "course",
  );
  if (
    existingOrder &&
    (existingOrder.order_kind !== "individual_course" ||
      existingOrder.order_items.length !== 1 ||
      !existingItem ||
      existingItem.course_id !== course.id ||
      existingItem.live_session_id !== (parsed.data.liveSessionId ?? null) ||
      existingItem.quantity !== 1 ||
      existingItem.unit_price_twd !== course.price_twd ||
      existingOrder.amount_twd !== course.price_twd)
  )
    return NextResponse.json(
      { error: "IDEMPOTENCY_SNAPSHOT_MISMATCH" },
      { status: 409 },
    );

  let order: {
    id: string;
    merchant_trade_no: string;
    amount_twd: number;
    status: string;
  } | null = existingOrder
    ? {
        id: existingOrder.id,
        merchant_trade_no: existingOrder.merchant_trade_no,
        amount_twd: existingOrder.amount_twd,
        status: existingOrder.status,
      }
    : null;
  let createdOrder = false;
  if (!order) {
    const merchantTradeNo = createMerchantTradeNo();
    const { data: created, error } = await admin
      .from("orders")
      .insert({
        buyer_id: userId,
        order_kind: "individual_course",
        merchant_trade_no: merchantTradeNo,
        checkout_idempotency_key: parsed.data.idempotencyKey,
        status: "pending",
        amount_twd: course.price_twd,
        payment_provider: "ecpay",
      })
      .select("id,merchant_trade_no,amount_twd,status")
      .single();
    if (error || !created)
      return NextResponse.json(
        { error: "ORDER_CREATE_FAILED" },
        { status: 500 },
      );
    const { error: itemError } = await admin
      .from("order_items")
      .insert({
        order_id: created.id,
        course_id: course.id,
        live_session_id: parsed.data.liveSessionId ?? null,
        item_type: "course",
        quantity: 1,
        unit_price_twd: course.price_twd,
      });
    if (itemError)
      return NextResponse.json(
        { error: "ORDER_ITEM_CREATE_FAILED" },
        { status: 500 },
      );
    order = created;
    createdOrder = true;
  }
  if (order.status === "paid")
    return NextResponse.json({ error: "ORDER_ALREADY_PAID" }, { status: 409 });
  if (parsed.data.liveSessionId) {
    if (!createdOrder && order.status === "failed")
      await admin
        .from("orders")
        .update({ status: "pending" })
        .eq("id", order.id);
    const { error: holdError } = await admin.rpc("reserve_live_seat", {
      target_session_id: parsed.data.liveSessionId,
      target_learner_id: userId,
      target_order_id: order.id,
    });
    if (holdError) {
      await admin
        .from("orders")
        .update({ status: "failed" })
        .eq("id", order.id);
      return NextResponse.json(
        {
          error: holdError.message.includes("FULL")
            ? "LIVE_SESSION_FULL"
            : "LIVE_SEAT_HOLD_FAILED",
          message: holdError.message.includes("FULL")
            ? "這個場次已額滿。"
            : "暫時無法保留座位，請重新選擇場次。",
        },
        { status: 409 },
      );
    }
  }

  const origin = appOrigin(request);
  const fields: Record<string, string> = {
    MerchantID: merchantId,
    MerchantTradeNo: order.merchant_trade_no,
    MerchantTradeDate: taipeiTradeDate(),
    PaymentType: "aio",
    TotalAmount: String(order.amount_twd),
    TradeDesc: parsed.data.liveSessionId
      ? "SuiyueAcademyLiveCourse"
      : "SuiyueAcademyRecordedCourse",
    ItemName: course.title.replace(/[#$&+<=>?@]/g, " ").slice(0, 200),
    ReturnURL: `${origin}/api/webhooks/ecpay`,
    OrderResultURL: `${origin}/api/payments/ecpay/result`,
    ClientBackURL: `${origin}/checkout/result?order=${encodeURIComponent(order.merchant_trade_no)}`,
    ChoosePayment: "ALL",
    EncryptType: "1",
    NeedExtraPaidInfo: "Y",
  };
  fields.CheckMacValue = createCheckMacValue(fields, hashKey, hashIv);
  return NextResponse.json(
    { action: checkoutUrl, fields },
    { headers: { "cache-control": "no-store" } },
  );
}
