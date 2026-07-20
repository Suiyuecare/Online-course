import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "歲悅學苑｜照顧專業，也可以學得很簡單",
    template: "%s｜歲悅學苑",
  },
  description:
    "歲悅學苑封閉試營運：一個帳號完成購課、看影片、學習紀錄、測驗與完課證明。",
  openGraph: {
    title: "歲悅學苑",
    description: "照顧專業，也可以學得很簡單。",
    type: "website",
    locale: "zh_TW",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "歲悅學苑：照顧專業，也可以學得很簡單",
      },
    ],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/suiyue-milk.png", apple: "/suiyue-milk.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
