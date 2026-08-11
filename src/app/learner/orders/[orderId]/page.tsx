import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PlatformApplication } from "@/application/platform";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { LiveBookingCard } from "@/components/live-booking-card";
import { OrderPaymentDetails } from "@/components/order-payment-details";
import { PaymentProofForm } from "@/components/payment-proof-form";
import { PendingOrderCancellation } from "@/components/pending-order-cancellation";
import { RefundRequestForm } from "@/components/refund-request-form";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const refundStatuses = {
  submitted: { label: "退款申請已送出", tone: "warning" as const },
  reviewing: { label: "退款審核中", tone: "warning" as const },
  approved: { label: "退款已核准", tone: "neutral" as const },
  rejected: { label: "退款申請未通過", tone: "danger" as const },
  disbursing: { label: "款項匯回中", tone: "warning" as const },
  partially_disbursed: {
    label: "部分款項已匯回",
    tone: "neutral" as const,
  },
  completed: { label: "退款已完成", tone: "success" as const },
  failed: { label: "退款匯回待處理", tone: "danger" as const },
};

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
  timeStyle: "short",
});

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

export default async function LearnerOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  let order:
    | Awaited<ReturnType<PlatformApplication["orderDetails"]>>
    | undefined;
  try {
    const { supabase } = await requireUser();
    order = await new PlatformApplication(supabase).orderDetails(orderId);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      redirect("/login");
    }
    if (error instanceof Error && error.message.includes("ORDER_NOT_FOUND")) {
      notFound();
    }
  }
  if (!order) {
    return (
      <section className="learner-order-unavailable learner-portal-shell-width">
        <span aria-hidden="true">
          <LearnerPortalIcon name="order" size={40} />
        </span>
        <p className="learner-kicker">訂單明細</p>
        <h1>目前無法安全讀取這筆訂單</h1>
        <p>訂單不會因此消失。請稍後重新讀取，或由客服協助確認。</p>
        <div>
          <Link className="button" href={`/learner/orders/${orderId}`}>
            重新讀取
          </Link>
          <Link className="button secondary" href="/support">
            聯絡客服
          </Link>
        </div>
      </section>
    );
  }

  const effectiveStatus = order.effectiveStatus;
  const activeRefund = order.refundCases.find(
    (refund) => refund.status !== "rejected",
  );
  const status = activeRefund
    ? {
        ...refundStatuses[activeRefund.status],
        description:
          "退款案件的最新進度如下；原始付款紀錄仍會保留供對帳與查詢。",
        nextAction: null,
      }
    : presentStatus("order", effectiveStatus);
  const acceptsPaymentProof = effectiveStatus === "pending_transfer";
  const refundableScopes = order.refundableScopes;
  const hasEligibleRefundScope =
    refundableScopes?.some((scope) => scope.eligible) ?? false;

  return (
    <section className="learner-order-detail learner-portal-shell-width">
      <Link className="learner-order-back" href="/learner/orders">
        <span aria-hidden="true">←</span>
        返回訂單紀錄
      </Link>

      <header>
        <div>
          <p className="learner-kicker">訂單 {order.orderNumber}</p>
          <h1>{order.courseTitle}</h1>
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

      <section className="learner-order-detail-summary">
        <div>
          <span>課程原價</span>
          <strong>{money(order.subtotalTwd)}</strong>
        </div>
        {order.discountTwd > 0 && (
          <div>
            <span>折扣券</span>
            <strong>− {money(order.discountTwd)}</strong>
          </div>
        )}
        <div>
          <span>應付金額</span>
          <strong>{money(order.amountDueTwd)}</strong>
        </div>
        <div>
          <span>已確認金額</span>
          <strong>NT$ {order.amountPaidTwd.toLocaleString("zh-TW")}</strong>
        </div>
        <div>
          <span>匯款期限</span>
          <strong>{dateTime.format(new Date(order.transferDueAt))}</strong>
        </div>
      </section>

      {order.paidAt && order.amountPaidTwd > 0 && (
        <div className="learner-payment-record-link-row">
          <Link
            className="button secondary"
            href={`/learner/orders/${order.orderId}/payment-record`}
          >
            檢視／列印付款紀錄
          </Link>
          <small>此紀錄僅供付款核對，非統一發票／電子發票。</small>
        </div>
      )}

      <div className={`status-card status-${status.tone}`}>
        <strong>{status.label}</strong>
        <p>{status.description}</p>
        {status.nextAction && <p>下一步：{status.nextAction}</p>}
      </div>

      <section className="learner-order-disclosure">
        <strong>積分狀態以訂單成立時的資料為準</strong>
        <p>{order.accreditationDisclosure}</p>
      </section>

      {order.coupon && (
        <section className="learner-order-coupon">
          <span aria-hidden="true">
            <LearnerPortalIcon name="discount" size={26} />
          </span>
          <div>
            <strong>{order.coupon.title}</strong>
            <p>
              本筆訂單已折抵 {money(order.coupon.discountTwd)}
              。付款確認後折扣券即核銷；後續退款不重新發券。
            </p>
          </div>
        </section>
      )}

      {acceptsPaymentProof ? (
        <section className="learner-order-payment-panel">
          <div>
            <p className="learner-kicker">銀行帳號匯款</p>
            <h2>匯款資料</h2>
            <p>請核對訂單編號與金額；提交資料後仍須等財務確認入帳。</p>
          </div>
          <OrderPaymentDetails order={order} />
          <PaymentProofForm
            targetId={order.orderId}
            amountTwd={order.amountDueTwd}
          />
          <PendingOrderCancellation orderId={order.orderId} />
        </section>
      ) : (
        <section
          className={`learner-order-payment-closed status-${status.tone}`}
        >
          <span aria-hidden="true">
            <LearnerPortalIcon
              name={
                status.tone === "success"
                  ? "check"
                  : status.tone === "danger"
                    ? "alert"
                    : "clock"
              }
              size={28}
            />
          </span>
          <div>
            <strong>
              {["proof_submitted", "payment_review"].includes(effectiveStatus)
                ? "財務正在核對，請勿重複匯款"
                : effectiveStatus === "expired"
                  ? "這筆匯款訂單已逾期"
                  : effectiveStatus === "cancelled"
                    ? "這筆訂單已取消"
                    : effectiveStatus === "rejected"
                      ? "匯款資料未通過"
                      : "目前不需要再次匯款或送件"}
            </strong>
            <p>
              {["proof_submitted", "payment_review"].includes(effectiveStatus)
                ? "財務核對期間請勿重複匯款；需要處理時，通知中心會清楚顯示。"
                : "為避免重複付款，此狀態不顯示完整匯款帳號。"}
            </p>
          </div>
        </section>
      )}

      {(order.liveBookingRepairs?.length ?? 0) > 0 && (
        <section className="live-booking-list">
          <h2>選擇免費替代直播場次</h2>
          <p>
            已付款但尚未取得名額，或原場次由歲悅取消時，可選擇仍有容量且至少 24
            小時後開課的場次。
          </p>
          {order.liveBookingRepairs?.map((booking) => (
            <LiveBookingCard
              booking={{ ...booking, canJoin: false }}
              key={booking.bookingId}
            />
          ))}
        </section>
      )}

      {order.refundCases.length > 0 && (
        <section className="learner-order-refund-history">
          <p className="learner-kicker">退款紀錄</p>
          <h2>退款與匯回進度</h2>
          {order.refundCases.map((refund) => {
            const refundStatus = refundStatuses[refund.status];
            return (
              <article key={refund.refundCaseId}>
                <span className={`status status-${refundStatus.tone}`}>
                  {refundStatus.label}
                </span>
                <strong>申請 {money(refund.requestedAmountTwd)}</strong>
                <p>
                  {refund.disbursedAmountTwd > 0
                    ? `已匯回 ${money(refund.disbursedAmountTwd)}`
                    : "尚無已完成的匯回款項"}
                </p>
                <small>
                  申請時間 {dateTime.format(new Date(refund.submittedAt))}
                </small>
              </article>
            );
          })}
        </section>
      )}

      {["paid", "paid_unfulfilled"].includes(effectiveStatus) &&
        (refundableScopes === undefined ? (
          <section className="learner-order-refund-closed">
            <strong>退款資格暫時無法確認</strong>
            <p>系統不會先假設整張訂單可以退款。請稍後重試或聯絡客服確認。</p>
          </section>
        ) : hasEligibleRefundScope ? (
          <RefundRequestForm
            orderId={order.orderId}
            scopes={refundableScopes}
          />
        ) : (
          <section className="learner-order-refund-closed">
            <strong>目前沒有可申請的退款範圍</strong>
            <p>實際結果依已提供的課程服務、積分狀態與既有退款紀錄計算。</p>
          </section>
        ))}
    </section>
  );
}
