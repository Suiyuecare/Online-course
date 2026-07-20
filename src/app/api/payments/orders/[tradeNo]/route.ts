import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tradeNo: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string")
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { tradeNo } = await params;
  const { data: order } = await admin
    .from("orders")
    .select(
      "status,merchant_trade_no,paid_at,order_kind,organization_id,order_items(course_id,courses(slug,title))",
    )
    .eq("merchant_trade_no", tradeNo)
    .eq("buyer_id", userId)
    .maybeSingle();
  if (!order)
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  if (
    order.order_kind !== "individual_course" &&
    order.order_kind !== "enterprise_seat_pack"
  )
    return NextResponse.json(
      { error: "ORDER_KIND_NOT_SUPPORTED" },
      { status: 409 },
    );
  return NextResponse.json(
    {
      order: {
        ...order,
        order_kind: order.order_kind,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
