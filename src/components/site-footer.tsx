import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner shell">
        <div className="footer-brand">
          <Link href="/" aria-label="歲悅學苑首頁">
            <Image alt="" height={48} src="/suiyue-milk.png" width={48} />
            <span>
              <strong>歲悅學苑</strong>
              <small>SUIYUECARE ACADEMY</small>
            </span>
          </Link>
          <p>讓長照進修的每一步都看得懂、跟得上，也留下值得信任的學習紀錄。</p>
        </div>
        <div className="footer-group">
          <strong>開始學習</strong>
          <Link href="/courses">課程總覽</Link>
          <Link href="/learner">我的學習</Link>
          <Link href="/login">手機登入</Link>
        </div>
        <div className="footer-group">
          <strong>培訓服務</strong>
          <Link href="/organization">機構培訓</Link>
          <Link href="/instructor">講師入口</Link>
          <Link href="/support">客服中心</Link>
        </div>
        <div className="footer-group">
          <strong>關於歲悅</strong>
          <a href="https://www.suiyuecare.com">歲悅長照官網</a>
          <Link href="/legal">服務契約與退款</Link>
          <Link href="/staff">工作人員入口</Link>
        </div>
        <div className="footer-bottom">
          <span>© 歲悅長照集團｜歲悅學苑</span>
          <span>訂單、課程與證明狀態以網站通知中心為準</span>
        </div>
      </div>
    </footer>
  );
}
