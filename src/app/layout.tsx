import type { Metadata } from "next";
import { SiteFrame } from "@/components/site-frame";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "歲悅學苑｜長照積分課程",
    template: "%s｜歲悅學苑",
  },
  description:
    "手機就能完成的長照積分課程：錄播、同步直播與混合課程，學習進度與出席證據清楚可查。",
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: "歲悅學苑",
    title: "歲悅學苑｜長照積分課程",
    description: "手機就能完成的錄播、同步直播與混合型長照積分課程。",
    images: [
      {
        url: "/suiyue-academy-og-v2.png",
        width: 1200,
        height: 630,
        alt: "歲悅學苑：長照進修，每一步都清楚",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/suiyue-academy-og-v2.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
