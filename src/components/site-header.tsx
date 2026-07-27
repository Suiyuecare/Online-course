import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="歲悅學苑首頁">
        <Image alt="" height={42} priority src="/suiyue-milk.png" width={42} />
        <span>
          歲悅學苑
          <small>長照積分課程</small>
        </span>
      </Link>
      <nav aria-label="主要選單">
        <Link href="/courses">找課程</Link>
        <Link href="/learner">我的課程</Link>
        <Link href="/support">客服</Link>
        <Link href="/instructor">講師</Link>
        <Link className="nav-action" href="/login">
          手機登入
        </Link>
      </nav>
    </header>
  );
}
