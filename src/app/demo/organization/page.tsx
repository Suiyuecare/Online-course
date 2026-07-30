import type { Metadata } from "next";
import { OrganizationDemo } from "./organization-demo";

export const metadata: Metadata = {
  title: "機構培訓操作示範",
  description: "歲悅學苑機構點數、員工邀請、批次派課與學習成果的安全操作示範。",
  robots: { index: false, follow: false },
};

export default function OrganizationDemoPage() {
  return <OrganizationDemo />;
}
