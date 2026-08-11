import Image from "next/image";
import Link from "next/link";
import type {
  LearnerOrderHistory,
  LearnerOrderHistoryCategory,
  LearnerOrderHistoryOrder,
} from "@/application/workspace";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { presentStatus } from "@/domain/presentation";

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const deliveryLabels = {
  recorded: "預錄課",
  live: "直播課",
  hybrid: "錄播＋直播",
};

const refundStatuses = {
  submitted: { label: "退款申請已送出", tone: "warning" },
  reviewing: { label: "退款審核中", tone: "warning" },
  approved: { label: "退款已核准", tone: "neutral" },
  rejected: { label: "退款申請未通過", tone: "danger" },
  disbursing: { label: "款項匯回中", tone: "warning" },
  partially_disbursed: { label: "部分款項已匯回", tone: "neutral" },
  completed: { label: "退款已完成", tone: "success" },
  failed: { label: "退款匯回待處理", tone: "danger" },
} as const;

const categoryOptions: {
  value: LearnerOrderHistoryCategory;
  label: string;
  description: string;
  icon: "order" | "alert" | "clock" | "check" | "refund";
  countKey:
    | "all"
    | "actionRequired"
    | "reviewing"
    | "completed"
    | "closedRefund";
}[] = [
  {
    value: "all",
    label: "全部訂單",
    description: "所有購課紀錄",
    icon: "order",
    countKey: "all",
  },
  {
    value: "action_required",
    label: "待我處理",
    description: "等待匯款或需確認",
    icon: "alert",
    countKey: "actionRequired",
  },
  {
    value: "reviewing",
    label: "核對中",
    description: "財務核對或開通中",
    icon: "clock",
    countKey: "reviewing",
  },
  {
    value: "completed",
    label: "已付款",
    description: "款項已確認",
    icon: "check",
    countKey: "completed",
  },
  {
    value: "closed_refund",
    label: "失效／退款",
    description: "已失效或退款紀錄",
    icon: "refund",
    countKey: "closedRefund",
  },
];

function formatDate(value: string | null) {
  return value ? dateTime.format(new Date(value)) : "—";
}

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

function orderPresentation(order: LearnerOrderHistoryOrder) {
  const activeRefund = order.refundCases.find(
    (refund) => refund.status !== "rejected",
  );
  if (activeRefund) {
    return refundStatuses[activeRefund.status];
  }
  return presentStatus("order", order.effectiveStatus);
}

function primaryActionLabel(order: LearnerOrderHistoryOrder) {
  if (order.refundCases.length > 0) return "查看退款與訂單明細";
  if (order.effectiveStatus === "pending_transfer") return "查看匯款資料";
  if (["proof_submitted", "payment_review"].includes(order.effectiveStatus)) {
    return "查看核對進度";
  }
  if (order.effectiveStatus === "paid") return "查看訂單與退款資格";
  if (order.effectiveStatus === "paid_unfulfilled") return "查看開通處理";
  return "查看完整明細";
}

function courseAccessLabel(
  item: LearnerOrderHistoryOrder["items"][number],
  order: LearnerOrderHistoryOrder,
) {
  if (item.entitlementStatus === "frozen") return "課程權限暫停";
  if (item.entitlementStatus === "revoked") return "課程權限已撤銷";
  if (item.entitlementStatus === "expired") return "課程權限已到期";
  if (item.entitlementStatus === "locked") return "待積分核定後開通";
  if (item.entitlementStatus === "active" && item.enrollmentStatus) {
    return presentStatus("enrollment", item.enrollmentStatus).label;
  }
  if (order.effectiveStatus === "paid_unfulfilled") return "待安排履約";
  if (order.effectiveStatus === "paid") return "課程開通處理中";
  return "付款確認後才會開通";
}

function OrderCard({ order }: { order: LearnerOrderHistoryOrder }) {
  const status = orderPresentation(order);

  return (
    <article className="learner-order-card">
      <header>
        <div>
          <span>訂單成立</span>
          <strong>{formatDate(order.createdAt)}</strong>
        </div>
        <div>
          <span>付款方式</span>
          <strong>銀行帳號匯款</strong>
        </div>
        <div>
          <span>{order.paidAt ? "實付金額" : "應付金額"}</span>
          <strong className="learner-order-total">
            {money(order.paidAt ? order.amountPaidTwd : order.amountDueTwd)}
          </strong>
        </div>
        <p className={`status status-${status.tone}`}>
          <LearnerPortalIcon
            name={
              status.tone === "success"
                ? "check"
                : status.tone === "danger"
                  ? "alert"
                  : "clock"
            }
            size={18}
          />
          {status.label}
        </p>
      </header>

      <div className="learner-order-items">
        {order.items.map((item) => (
          <div className="learner-order-item" key={item.courseVersionId}>
            <div className="learner-order-cover" aria-hidden="true">
              {item.hasCover ? (
                <Image
                  alt=""
                  fill
                  sizes="(max-width: 720px) 112px, 154px"
                  src={`/api/catalog/courses/${item.courseVersionId}/cover`}
                  unoptimized
                />
              ) : (
                <>
                  <span>
                    <LearnerPortalIcon name="book" size={34} />
                  </span>
                  <i />
                  <b />
                </>
              )}
            </div>
            <div className="learner-order-item-copy">
              <span>{deliveryLabels[item.deliveryType]}・長照積分課程</span>
              <h2>{item.courseTitle}</h2>
              <small>{courseAccessLabel(item, order)}</small>
            </div>
            <strong>{money(item.amountTwd)}</strong>
          </div>
        ))}
      </div>

      <details className="learner-order-details">
        <summary>
          <span>查看明細</span>
          <LearnerPortalIcon name="chevron" size={18} />
        </summary>
        <div>
          <dl>
            <div>
              <dt>訂單編號</dt>
              <dd>{order.orderNumber}</dd>
            </div>
            <div>
              <dt>訂單成立</dt>
              <dd>{formatDate(order.createdAt)}</dd>
            </div>
            <div>
              <dt>匯款期限</dt>
              <dd>{formatDate(order.transferDueAt)}</dd>
            </div>
            <div>
              <dt>付款確認</dt>
              <dd>{formatDate(order.paidAt)}</dd>
            </div>
            <div>
              <dt>課程原價</dt>
              <dd>{money(order.subtotalTwd)}</dd>
            </div>
            <div>
              <dt>折扣券</dt>
              <dd>
                {order.coupon
                  ? `${order.coupon.title}（− ${money(order.discountTwd)}）`
                  : "未使用"}
              </dd>
            </div>
            <div>
              <dt>應付金額</dt>
              <dd>{money(order.amountDueTwd)}</dd>
            </div>
            <div>
              <dt>已確認金額</dt>
              <dd>{money(order.amountPaidTwd)}</dd>
            </div>
          </dl>

          {order.refundCases.length > 0 && (
            <section aria-label="退款進度" className="learner-refund-timeline">
              <h3>退款紀錄</h3>
              {order.refundCases.map((refund) => {
                const refundStatus = refundStatuses[refund.status];
                return (
                  <div key={refund.refundCaseId}>
                    <span className={`status status-${refundStatus.tone}`}>
                      {refundStatus.label}
                    </span>
                    <p>
                      申請 {money(refund.requestedAmountTwd)}
                      {refund.disbursedAmountTwd > 0 &&
                        `・已匯回 ${money(refund.disbursedAmountTwd)}`}
                    </p>
                    <small>
                      申請時間 {formatDate(refund.submittedAt)}
                      {refund.completedAt &&
                        `・完成時間 ${formatDate(refund.completedAt)}`}
                    </small>
                  </div>
                );
              })}
            </section>
          )}

          <div className="learner-order-detail-actions">
            <Link
              className="button secondary"
              href={`/learner/orders/${order.orderId}`}
            >
              {primaryActionLabel(order)}
            </Link>
            {order.paidAt && order.amountPaidTwd > 0 && (
              <Link
                className="button secondary"
                href={`/learner/orders/${order.orderId}/payment-record`}
              >
                付款紀錄
              </Link>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}

export function LearnerOrderHistoryView({
  activeCategory,
  history,
  paginated,
}: {
  activeCategory: LearnerOrderHistoryCategory;
  history: LearnerOrderHistory;
  paginated: boolean;
}) {
  const totalOrders = history.counts.all;
  const next = history.nextCursor;
  const nextQuery = next
    ? new URLSearchParams({
        category: activeCategory,
        beforeAt: next.createdAt,
        beforeId: next.orderId,
      }).toString()
    : null;

  return (
    <div className="learner-order-history">
      <section className="learner-order-hero">
        <div className="learner-portal-shell-width">
          <span aria-hidden="true">
            <LearnerPortalIcon name="order" size={34} />
          </span>
          <div>
            <p className="learner-kicker">付款、開通與退款</p>
            <h1>訂單紀錄</h1>
            <p>匯款期限、財務核對、課程開通與退款進度，都會完整保留在這裡。</p>
          </div>
          <strong>{totalOrders} 筆訂單</strong>
        </div>
      </section>

      <div className="learner-portal-shell-width learner-order-content">
        <nav aria-label="訂單狀態" className="learner-order-categories">
          {categoryOptions.map((option) => {
            const count = history.counts[option.countKey];
            return (
              <Link
                aria-current={
                  activeCategory === option.value ? "page" : undefined
                }
                href={`/learner/orders?category=${option.value}`}
                key={option.value}
              >
                <span aria-hidden="true">
                  <LearnerPortalIcon name={option.icon} size={27} />
                </span>
                <strong>
                  {option.label}
                  {count > 0 && <i>{count}</i>}
                </strong>
                <small>{option.description}</small>
              </Link>
            );
          })}
        </nav>

        {history.orders.length === 0 ? (
          <section className="learner-order-empty">
            <span aria-hidden="true">
              <LearnerPortalIcon name="order" size={42} />
            </span>
            <h2>
              {totalOrders === 0 ? "目前還沒有訂單" : "這個分類目前沒有訂單"}
            </h2>
            <p>
              {totalOrders === 0
                ? "選好課程並完成契約確認後，新的匯款訂單會出現在這裡。"
                : "可以切換到「全部訂單」，查看其他付款與退款紀錄。"}
            </p>
            <Link
              className="button"
              href={
                totalOrders === 0
                  ? "/learner/catalog"
                  : "/learner/orders?category=all"
              }
            >
              {totalOrders === 0 ? "探索課程" : "查看全部訂單"}
            </Link>
          </section>
        ) : (
          <section aria-label="訂單列表" className="learner-order-card-list">
            {history.orders.map((order) => (
              <OrderCard key={order.orderId} order={order} />
            ))}
          </section>
        )}

        {(paginated || history.hasMore) && (
          <nav aria-label="訂單分頁" className="learner-order-pagination">
            {paginated && (
              <Link
                className="button secondary"
                href={`/learner/orders?category=${activeCategory}`}
              >
                回到最新訂單
              </Link>
            )}
            {history.hasMore && nextQuery && (
              <Link
                className="button secondary"
                href={`/learner/orders?${nextQuery}`}
              >
                查看較舊訂單
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
