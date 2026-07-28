import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="歲悅學苑首頁">
        <Image alt="" height={50} priority src="/suiyue-milk.png" width={50} />
        <span>
          <strong>歲悅學苑</strong>
          <small>SUIYUECARE ACADEMY</small>
        </span>
      </Link>
      <nav aria-label="主要選單">
        <Link href="/courses">課程總覽</Link>
        <Link href="/learner">我的學習</Link>
        <Link href="/organization">機構培訓</Link>
        <Link href="/support">客服中心</Link>
        <Link className="nav-action" href="/login">
          手機登入
        </Link>
      </nav>
    </header>
  );
}
