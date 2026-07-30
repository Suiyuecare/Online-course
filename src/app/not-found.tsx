import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell not-found-page">
      <div aria-hidden="true" className="not-found-mark">
        404
      </div>
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1>這一頁暫時找不到</h1>
      <p>
        網址可能已更新，或內容尚未開放。你可以回到課程總覽，或用功能導覽繼續體驗歲悅學苑。
      </p>
      <div>
        <Link className="button" href="/courses">
          前往課程總覽
        </Link>
        <Link className="button secondary" href="/demo">
          查看功能導覽
        </Link>
      </div>
    </main>
  );
}
