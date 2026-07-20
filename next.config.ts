import type { NextConfig } from "next";

const developmentConnect =
  process.env.NODE_ENV === "development"
    ? " http://127.0.0.1:54321 ws://localhost:*"
    : "";
const ecpayPaymentOrigin =
  process.env.ECPAY_ENV === "production"
    ? "https://payment.ecpay.com.tw"
    : "https://payment-stage.ecpay.com.tw";
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://embed.cloudflarestream.com https://source.zoom.us https://*.zoom.us",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.zoom.us https://*.zoom.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co https://api.cloudflare.com https://upload.videodelivery.net https://*.cloudflarestream.com https://*.zoom.us https://*.zoom.com wss://*.zoom.us wss://*.zoom.com${developmentConnect}`,
  "frame-src https://*.cloudflarestream.com https://*.zoom.us https://*.zoom.com",
  `form-action 'self' ${ecpayPaymentOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@zoom/download-manager": "./src/lib/zoom-download-manager-shim.ts",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
