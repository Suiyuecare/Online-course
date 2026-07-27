import { notFound, redirect } from "next/navigation";
import { PlatformApplication } from "@/application/platform";
import { LiveBookingCard } from "@/components/live-booking-card";
import { OrderPaymentDetails } from "@/components/order-payment-details";
import { PaymentProofForm } from "@/components/payment-proof-form";
import { RefundRequestForm } from "@/components/refund-request-form";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  let order: Awaited<ReturnType<PlatformApplication["orderDetails"]>>;
  try {
    const { supabase } = await requireUser();
    order = await new PlatformApplication(supabase).orderDetails(orderId);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      redirect("/login");
    }
    notFound();
  }
  const status = presentStatus("order", order.status);
  return (
    <section className="page-shell narrow shell">
      <p className="eyebrow">人工銀行匯款</p>
      <h1>{order.courseTitle}</h1>
      <div className="warning-panel">
        <strong>提交核對資料不等於付款完成</strong>
        <p>{order.accreditationDisclosure}</p>
      </div>
      <div className={`status-card status-${status.tone}`}>
        <strong>{status.label}</strong>
        <p>{status.description}</p>
        {status.nextAction && <p>下一步：{status.nextAction}</p>}
      </div>
      <OrderPaymentDetails order={order} />
      {(order.liveBookingRepairs?.length ?? 0) > 0 && (
        <section className="live-booking-list">
          <h2>選擇免費替代直播場次</h2>
          <p>
            已付款但未取得名額，或原場次由歲悅取消時，可在這裡自行選擇仍有容量且至少
            24 小時後開課的場次。若不接受替代場次，仍可依下方流程申請退款。
          </p>
          {order.liveBookingRepairs?.map((booking) => (
            <LiveBookingCard
              booking={{ ...booking, canJoin: false }}
              key={booking.bookingId}
            />
          ))}
        </section>
      )}
      {["pending_transfer", "needs_correction"].includes(order.status) ? (
        <PaymentProofForm
          targetId={order.orderId}
          amountTwd={order.amountDueTwd}
        />
      ) : (
        <div className="closed-note">
          {["proof_submitted", "payment_review"].includes(order.status)
            ? "財務核對期間不需重複送件；需要補正時，通知中心會清楚顯示。"
            : "此狀態目前不接受新的匯款資料。"}
        </div>
      )}
      {["paid", "paid_unfulfilled"].includes(order.status) && (
        <RefundRequestForm
          orderId={order.orderId}
          scopes={
            order.refundableScopes ?? [
              {
                scopeType: "whole_order",
                scopeId: null,
                label: "整張訂單",
                eligible: true,
                ineligibleReason: null,
              },
            ]
          }
        />
      )}
    </section>
  );
}
