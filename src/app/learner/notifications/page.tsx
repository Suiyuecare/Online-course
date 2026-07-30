import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationReadButton } from "@/components/notification-read-button";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const pageSize = 20;

export default async function NotificationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const start = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from("notifications")
    .select("id,title,body,created_at,read_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1);
  const available = !error;
  const notifications = available ? (data ?? []) : [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const unreadOnPage = notifications.some((item) => !item.read_at);

  return (
    <section className="learner-portal-page learner-portal-shell-width learner-narrow-page">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">通知中心</p>
          <h1>重要進度都在這裡</h1>
          <p>付款、上課、審核與證明狀態會保留在網站內。</p>
        </div>
        {available && unreadOnPage && <NotificationReadButton markAll />}
      </header>
      {!available ? (
        <div className="warning-panel" role="alert">
          <strong>通知目前無法安全讀取</strong>
          <p>
            系統不會把連線問題顯示成「沒有通知」。請重新讀取；付款、課程與證明狀態不會因此被刪除。
          </p>
          <div className="button-row">
            <Link className="button" href="/learner/notifications">
              重新讀取
            </Link>
            <Link className="button secondary" href="/support">
              聯絡客服
            </Link>
          </div>
        </div>
      ) : notifications.length ? (
        <>
          <div className="notification-list">
            {notifications.map((item) => (
              <article className={item.read_at ? "" : "unread"} key={item.id}>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <time>{new Date(item.created_at).toLocaleString("zh-TW")}</time>
                {!item.read_at && (
                  <NotificationReadButton notificationId={item.id} />
                )}
              </article>
            ))}
          </div>
          {pageCount > 1 && (
            <nav aria-label="通知分頁" className="learner-pagination">
              {page > 1 ? (
                <Link href={`/learner/notifications?page=${page - 1}`}>
                  上一頁
                </Link>
              ) : (
                <span aria-disabled="true">上一頁</span>
              )}
              <span>
                第 {page}／{pageCount} 頁，共 {total} 則
              </span>
              {page < pageCount ? (
                <Link href={`/learner/notifications?page=${page + 1}`}>
                  下一頁
                </Link>
              ) : (
                <span aria-disabled="true">下一頁</span>
              )}
            </nav>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h2>目前沒有通知</h2>
          <p>Email 或簡訊失敗不會改變這裡保存的正式狀態。</p>
        </div>
      )}
    </section>
  );
}
