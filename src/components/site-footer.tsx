import Link from "next/link";
import { Brand } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-[#3C260F] text-[#E8D9C7]">
      <div className="page-shell grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Brand inverse />
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#D6C3AD]">
            照顧專業，也可以學得很簡單。從一般錄播到正式積分課，都用清楚、安心的步驟完成。
          </p>
        </div>
        <div>
          <p className="footer-title">開始學習</p>
          <Link href="/courses">探索課程</Link>
          <Link href="/dashboard">我的學習</Link>
          <Link href="/certificate/demo">完課證明驗證</Link>
        </div>
        <div>
          <p className="footer-title">平台說明</p>
          <span className="mt-3 block text-sm text-[#D6C3AD]">
            正式積分課依核定資料發布
          </span>
          <span className="mt-3 block text-sm text-[#D6C3AD]">
            付款使用綠界測試環境
          </span>
          <span className="mt-3 block text-sm text-[#D6C3AD]">
            退款由管理員人工審核
          </span>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-[#BDA78F]">
        © 2026 歲悅學苑
      </div>
    </footer>
  );
}
