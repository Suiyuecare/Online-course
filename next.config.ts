import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
const connectDevelopment = isDevelopment
  ? " http://127.0.0.1:54321 ws://127.0.0.1:54321"
  : "";
const scriptDevelopment = isDevelopment ? " 'unsafe-eval'" : "";

const learnerCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${scriptDevelopment} https://challenges.cloudflare.com https://embed.cloudflarestream.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co https://*.cloudflarestream.com${connectDevelopment}`,
  "frame-src 'self' blob: https://challenges.cloudflare.com https://*.cloudflarestream.com",
  "media-src 'self' blob: https://*.cloudflarestream.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// Zoom's Web Meeting SDK compiles WebAssembly and creates blob workers at
// runtime. Keep these allowances isolated to dedicated live-classroom routes.
// Trusted Types enforcement is intentionally omitted here because SDK 6.2.0
// does not publish a compatible policy and would otherwise fail before init.
const zoomClassroomCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://zoom.us https://*.zoom.us https://dmogdx0jrul3u.cloudfront.net",
  "style-src 'self' 'unsafe-inline' https://zoom.us https://*.zoom.us",
  "img-src 'self' data: blob: https://zoom.us https://*.zoom.us https://dmogdx0jrul3u.cloudfront.net",
  `connect-src 'self' https://*.supabase.co https://zoom.us https://*.zoom.us wss://*.zoom.us https://dmogdx0jrul3u.cloudfront.net${connectDevelopment}`,
  "media-src 'self' blob: https://zoom.us https://*.zoom.us https://dmogdx0jrul3u.cloudfront.net",
  "font-src 'self' data: https://zoom.us https://*.zoom.us https://dmogdx0jrul3u.cloudfront.net",
  "worker-src 'self' blob:",
  "frame-src 'self' https://zoom.us https://*.zoom.us",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: learnerCsp },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["exceljs"],
  turbopack: {
    resolveAlias: {
      "@zoom/download-manager":
        "./src/infrastructure/adapters/zoom-download-manager-shim.ts",
    },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/live/:path*",
        headers: securityHeaders.map((header) =>
          header.key === "Content-Security-Policy"
            ? { ...header, value: zoomClassroomCsp }
            : header,
        ),
      },
      {
        source: "/staff/live/:path*",
        headers: securityHeaders.map((header) =>
          header.key === "Content-Security-Policy"
            ? { ...header, value: zoomClassroomCsp }
            : header,
        ),
      },
      {
        source: "/verify/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, noarchive, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
