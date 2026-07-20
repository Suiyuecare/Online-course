import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/env";
import { verifyCheckMacValue } from "@/lib/ecpay";

export async function POST(request: Request) {
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  const valid = Boolean(
    process.env.ECPAY_HASH_KEY &&
      process.env.ECPAY_HASH_IV &&
      verifyCheckMacValue(
        params,
        process.env.ECPAY_HASH_KEY!,
        process.env.ECPAY_HASH_IV!,
      ),
  );
  const destination = new URL("/checkout/result", appOrigin(request));
  if (params.MerchantTradeNo)
    destination.searchParams.set("order", params.MerchantTradeNo);
  destination.searchParams.set("returned", valid ? "1" : "0");
  return NextResponse.redirect(destination, 303);
}
