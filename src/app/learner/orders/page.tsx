import Link from "next/link";
import { redirect } from "next/navigation";
import { readOwnOrders } from "@/application/workspace";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function LearnerOrdersPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  let orders;
  try {
    orders = await readOwnOrders(supabase);
  } catch {
    return (
      <section className="learner-portal-page learner-portal-shell-width">
        <p className="eyebrow">我的訂單</p>
        <h1>目前無法讀取訂單</h1>
        <div className="warning-panel">
          <strong>訂單資料仍受保護</strong>
          <p>
            讀取服務尚未準備完成時，網站不會改用較寬鬆的管理權限查詢。請稍後再試或從通知中心開啟指定訂單。
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="learner-portal-page learner-portal-shell-width">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">付款與退款</p>
          <h1>我的訂單</h1>
          <p>查看匯款期限、補件、確認、取消與退款進度。</p>
        </div>
        {orders.length > 0 && <strong>{orders.length} 筆紀錄</strong>}
      </header>
      {orders.length === 0 ? (
        <div className="empty-state">
          <h2>目前沒有訂單</h2>
          <p>建立課程訂單後，匯款期限、補件、確認與退款狀態都會留在這裡。</p>
          <Link className="button" href="/courses">
            去找課程
          </Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((order) => {
            const status = presentStatus("order", order.status);
            return (
              <article key={order.orderId}>
                <div>
                  <p className={`status status-${status.tone}`}>
                    {status.label}
                  </p>
                  <h2>{order.courseTitle}</h2>
                  <p>訂單編號：{order.orderNumber}</p>
                  <p>{status.nextAction ?? status.description}</p>
                </div>
                <div>
                  <strong>
                    NT$ {order.amountDueTwd.toLocaleString("zh-TW")}
                  </strong>
                  <time dateTime={order.createdAt}>
                    {new Date(order.createdAt).toLocaleDateString("zh-TW")}
                  </time>
                </div>
                <Link
                  className="button secondary"
                  href={`/orders/${order.orderId}`}
                >
                  查看訂單與下一步
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
