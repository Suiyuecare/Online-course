import Image from "next/image";
import Link from "next/link";
import { learnerCourseTaxonomy } from "@/content/showcase-courses";

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
      <div className="site-header-discovery">
        <details className="site-explore-menu">
          <summary aria-label="探索課程分類">
            探索
            <svg
              aria-hidden="true"
              fill="none"
              height="18"
              viewBox="0 0 24 24"
              width="18"
            >
              <path
                d="m7 10 5 5 5-5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </summary>
          <div className="site-explore-panel">
            <div className="site-explore-panel-heading">
              <div>
                <strong>依照護需求探索</strong>
                <small>選擇你現在最想加強的主題</small>
              </div>
              <Link href="/courses#course-search">查看全部課程</Link>
            </div>
            <div className="site-explore-grid">
              {learnerCourseTaxonomy.map((item, index) => (
                <Link
                  href={`/courses?category=${encodeURIComponent(item.title)}#course-search`}
                  key={item.title}
                >
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </details>
        <form
          action="/courses"
          aria-label="搜尋歲悅學苑課程"
          className="site-course-search"
          method="get"
          role="search"
        >
          <label className="visually-hidden" htmlFor="site-course-search">
            搜尋課程
          </label>
          <svg
            aria-hidden="true"
            fill="none"
            height="20"
            viewBox="0 0 24 24"
            width="20"
          >
            <circle
              cx="11"
              cy="11"
              r="6.5"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="m16 16 4 4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
          <input
            autoComplete="off"
            enterKeyHint="search"
            id="site-course-search"
            maxLength={100}
            name="q"
            placeholder="搜尋失智、吞嚥、感染管制…"
            type="search"
          />
          <button type="submit">搜尋</button>
        </form>
      </div>
      <nav aria-label="主要選單">
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
