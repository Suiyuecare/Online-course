import type { Metadata } from "next";
import Link from "next/link";
import { StaffDemo } from "./staff-demo";
import styles from "./staff-demo.module.css";

export const metadata: Metadata = {
  title: "平台管理員操作示範",
  description:
    "示範歲悅學苑如何建課、檢查發布條件、審核匯款、處理出席異常與保留稽核紀錄。",
  robots: { index: false, follow: false, noarchive: true },
};

export default function StaffDemoPage() {
  return (
    <div className={styles.page}>
      <div className={styles.notice} role="status">
        <strong>操作示範環境</strong>
        <span>以下均為合成資料，不會發布課程、確認付款或修改正式紀錄。</span>
        <Link href="/demo">返回 Demo 導覽</Link>
      </div>
      <StaffDemo />
    </div>
  );
}
