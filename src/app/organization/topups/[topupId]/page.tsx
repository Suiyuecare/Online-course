import { notFound, redirect } from "next/navigation";
import { PlatformApplication } from "@/application/platform";
import { PaymentProofForm } from "@/components/payment-proof-form";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function PointTopupPage({
  params,
}: {
  params: Promise<{ topupId: string }>;
}) {
  const { topupId } = await params;
  let topup: Awaited<ReturnType<PlatformApplication["pointTopupDetails"]>>;
  try {
    const { supabase } = await requireUser();
    topup = await new PlatformApplication(supabase).pointTopupDetails(topupId);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      redirect("/login");
    }
    notFound();
  }
  const status = presentStatus("order", topup.status);
  return (
    <section className="page-shell narrow shell">
      <p className="eyebrow">機構購點</p>
      <h1>{topup.points.toLocaleString("zh-TW")} 點</h1>
      <div className="warning-panel">
        <strong>NT$1 = 1 點，所有購點固定需要第二人確認</strong>
        <p>proof 不會鑄造點數；兩位不同財務人員確認銀行入帳後才會入錢包。</p>
      </div>
      <div className={`status-card status-${status.tone}`}>
        <strong>{status.label}</strong>
        <p>{status.description}</p>
        {status.nextAction && <p>下一步：{status.nextAction}</p>}
      </div>
      <dl className="payment-instructions">
        <div>
          <dt>應匯金額</dt>
          <dd>NT$ {topup.amountDueTwd.toLocaleString("zh-TW")}</dd>
        </div>
        <div>
          <dt>銀行／代碼</dt>
          <dd>
            {topup.bankName}（{topup.bankCode}）
          </dd>
        </div>
        <div>
          <dt>戶名</dt>
          <dd>{topup.accountName}</dd>
        </div>
        <div>
          <dt>帳號</dt>
          <dd>{topup.accountNumber}</dd>
        </div>
      </dl>
      {["pending_transfer", "needs_correction"].includes(topup.status) ? (
        <PaymentProofForm
          targetId={topup.topupId}
          targetType="topup"
          amountTwd={topup.amountDueTwd}
        />
      ) : (
        <div className="closed-note">
          {["proof_submitted", "payment_review"].includes(topup.status)
            ? "財務核對期間不需重複送件。"
            : "此狀態目前不接受新的匯款資料。"}
        </div>
      )}
    </section>
  );
}
