import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    cloudflareStream: Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID &&
        process.env.CLOUDFLARE_STREAM_API_TOKEN &&
        process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE &&
        process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
    ),
    zoom: Boolean(
      process.env.ZOOM_ACCOUNT_ID &&
        process.env.ZOOM_CLIENT_ID &&
        process.env.ZOOM_CLIENT_SECRET &&
        process.env.ZOOM_HOST_USER_ID &&
        process.env.ZOOM_MEETING_SDK_KEY &&
        process.env.ZOOM_MEETING_SDK_SECRET &&
        process.env.ZOOM_WEBHOOK_SECRET_TOKEN &&
        process.env.LIVE_SECRET_ENCRYPTION_KEY,
    ),
    ecpay: Boolean(
      process.env.ECPAY_MERCHANT_ID &&
        process.env.ECPAY_HASH_KEY &&
        process.env.ECPAY_HASH_IV,
    ),
    ecpayInvoice: Boolean(
      process.env.ECPAY_INVOICE_MERCHANT_ID &&
        process.env.ECPAY_INVOICE_HASH_KEY &&
        process.env.ECPAY_INVOICE_HASH_IV,
    ),
    learnerDataEncryption: Boolean(process.env.LEARNER_DATA_ENCRYPTION_KEY),
    featureGates: {
      closedBeta: true,
      recordedCourses: true,
      accreditationRecordedCourses: true,
      liveCourses: process.env.FEATURE_LIVE_COURSES === "true",
      enterprise: process.env.FEATURE_ENTERPRISE === "true",
      subscriptions: false,
      autoRenewal: false,
      automaticRefunds: false,
      electronicInvoices:
        process.env.FEATURE_ENTERPRISE === "true" &&
        Boolean(
          process.env.ECPAY_INVOICE_MERCHANT_ID &&
            process.env.ECPAY_INVOICE_HASH_KEY &&
            process.env.ECPAY_INVOICE_HASH_IV,
        ),
    },
  });
}
