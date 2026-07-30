import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PlatformApplication } from "@/application/platform";
import { PaymentRecordPrintButton } from "@/components/payment-record-print-button";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "付款紀錄" };

const paidDate = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

function UnavailablePaymentRecord({ orderId }: { orderId: string }) {
  return (
    <section className="learner-order-unavailable learner-portal-shell-width">
      <p className="learner-kicker">付款紀錄</p>
      <h1>目前無法安全讀取付款紀錄</h1>
      <p>
        系統不會用其他人的訂單或示範資料代替。請稍後重新讀取，原始訂單不會因此消失。
      </p>
      <div>
        <Link
          className="button"
          href={`/learner/orders/${orderId}/payment-record`}
        >
          重新讀取
        </Link>
        <Link className="button secondary" href="/support">
          聯絡客服
        </Link>
      </div>
    </section>
  );
}

export default async function LearnerPaymentRecordPage({
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
    return <UnavailablePaymentRecord orderId={orderId} />;
  }

  if (
    order.amountPaidTwd <= 0 ||
    !order.paidAt ||
    !Number.isFinite(Date.parse(order.paidAt))
  ) {
    notFound();
  }

  const relevantRefunds = order.refundCases.filter(
    (refund) => refund.status !== "rejected",
  );
  const refundedTwd = relevantRefunds.reduce(
    (total, refund) => total + refund.disbursedAmountTwd,
    0,
  );

  return (
    <div className="payment-record-page learner-portal-shell-width">
      <nav aria-label="付款紀錄操作" className="payment-record-actions">
        <Link
          className="button secondary"
          href={`/learner/orders/${order.orderId}`}
        >
          返回訂單明細
        </Link>
        <PaymentRecordPrintButton />
      </nav>

      <article
        aria-labelledby="payment-record-title"
        className="payment-record-sheet"
      >
        <header className="payment-record-heading">
          <div>
            <p>歲悅學苑</p>
            <h1 id="payment-record-title">付款紀錄</h1>
          </div>
          <strong>非統一發票／電子發票</strong>
        </header>

        <section className="payment-record-notice">
          <strong>付款紀錄，非統一發票／電子發票</strong>
          <p>
            本頁僅供核對歲悅學苑訂單的實際入帳情形，不具統一發票、電子發票或其他稅務憑證效力。
          </p>
        </section>

        <dl className="payment-record-overview">
          <div>
            <dt>訂單編號</dt>
            <dd>{order.orderNumber}</dd>
          </div>
          <div>
            <dt>付款確認日期</dt>
            <dd>{paidDate.format(new Date(order.paidAt))}</dd>
          </div>
          <div>
            <dt>付款方式</dt>
            <dd>銀行帳號匯款</dd>
          </div>
          <div>
            <dt>課程</dt>
            <dd>{order.courseTitle}</dd>
          </div>
        </dl>

        <section className="payment-record-amounts" aria-label="付款金額">
          <h2>金額明細</h2>
          <dl>
            <div>
              <dt>課程原價</dt>
              <dd>{money(order.subtotalTwd)}</dd>
            </div>
            <div>
              <dt>折扣</dt>
              <dd>
                {order.discountTwd > 0
                  ? `− ${money(order.discountTwd)}`
                  : money(0)}
              </dd>
            </div>
            <div className="payment-record-paid-total">
              <dt>實際付款</dt>
              <dd>{money(order.amountPaidTwd)}</dd>
            </div>
          </dl>
        </section>

        {relevantRefunds.length > 0 && (
          <aside className="payment-record-refund-note">
            <h2>退款調整說明</h2>
            <p>
              本頁的「實際付款」保留原始入帳金額，不會因後續退款而改寫。
              {refundedTwd > 0
                ? `目前退款紀錄顯示已匯回 ${money(refundedTwd)}，請搭配訂單退款進度核對。`
                : "目前已有退款案件處理中，尚無已完成的匯回金額。"}
            </p>
          </aside>
        )}

        <footer className="payment-record-footer">
          <p>此紀錄由歲悅學苑訂單系統依付款確認資料產生。</p>
          <p>如對內容有疑問，請登入後由客服中心提出查詢。</p>
        </footer>
      </article>
    </div>
  );
}
