import type { Metadata } from "next";
import { SiteFrame } from "@/components/site-frame";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "歲悅學苑｜長照積分課程封閉展示",
    template: "%s｜歲悅學苑",
  },
  description:
    "歲悅學苑封閉展示版：預覽長照積分課程的錄播、同步直播、混合課程與學習紀錄流程；目前尚未開放報名或付款。",
  icons: {
    icon: [{ url: "/suiyue-milk.png", type: "image/png" }],
    apple: [{ url: "/suiyue-milk.png", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: "歲悅學苑",
    title: "歲悅學苑｜長照積分課程封閉展示",
    description:
      "預覽錄播、同步直播、混合型長照積分課程與學習紀錄流程；目前尚未開放報名或付款。",
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
