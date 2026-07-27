import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>歲悅學苑</strong>
        <p>網站通知中心是訂單、上課與證明狀態的權威紀錄。</p>
      </div>
      <div className="footer-links">
        <Link href="/legal">服務契約與退款</Link>
        <Link href="/organization">機構專區</Link>
        <Link href="/staff">工作人員</Link>
      </div>
    </footer>
  );
}
