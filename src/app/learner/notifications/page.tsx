import { redirect } from "next/navigation";
import { NotificationReadButton } from "@/components/notification-read-button";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function NotificationPage() {
  let notifications: {
    id: string;
    title: string;
    body: string;
    created_at: string;
    read_at: string | null;
  }[] = [];
  try {
    const { supabase } = await requireUser();
    const { data } = await supabase
      .from("notifications")
      .select("id,title,body,created_at,read_at")
      .order("created_at", { ascending: false });
    notifications = data ?? [];
  } catch {
    redirect("/login");
  }
  return (
    <section className="page-shell narrow shell">
      <p className="eyebrow">權威通知紀錄</p>
      <h1>通知中心</h1>
      {notifications.length ? (
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
      ) : (
        <div className="empty-state">
          <h2>目前沒有通知</h2>
          <p>Email 或簡訊失敗不會改變這裡保存的正式狀態。</p>
        </div>
      )}
    </section>
  );
}
