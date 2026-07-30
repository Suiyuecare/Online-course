import { notFound } from "next/navigation";
import { readCheckoutCouponOptions } from "@/application/workspace";
import { ContractPurchaseFlow } from "@/components/contract-purchase-flow";
import { RefundAllocationDisclosure } from "@/components/refund-allocation-disclosure";
import {
  catalogCourse,
  coursePurchaseReadiness,
} from "@/infrastructure/supabase/catalog";
import { userSupabase } from "@/infrastructure/supabase/server";

async function checkoutContext(courseVersionId: string) {
  try {
    const supabase = await userSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { accountId: null, coupons: [] };
    const accountId = data.user.id;
    try {
      return {
        accountId,
        coupons: await readCheckoutCouponOptions(supabase, courseVersionId),
      };
    } catch {
      return { accountId, coupons: [] };
    }
  } catch {
    return { accountId: null, coupons: [] };
  }
}

export default async function ContractPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await catalogCourse(slug);
  if (!course) notFound();
  const [readiness, checkout] = await Promise.all([
    coursePurchaseReadiness(course.course_version_id),
    checkoutContext(course.course_version_id),
  ]);
  return (
    <section className="page-shell narrow shell">
      <p className="eyebrow">單堂購買</p>
      <h1>{course.title}</h1>
      <p className="lead">
        依序完成契約審閱與第二次確認。送出匯款資料不代表付款完成；只有財務確認銀行實際入帳後才會開通。
      </p>
      {course.accreditation_status === "applying" && (
        <div className="warning-panel">
          <strong>積分申請中、尚未核定，不保證取得點數</strong>
          <p>核准前付款權限會保持鎖定。</p>
        </div>
      )}
      <RefundAllocationDisclosure course={course} />
      {readiness.purchaseReady ? (
        <ContractPurchaseFlow
          accountId={checkout.accountId}
          coupons={checkout.coupons}
          course={course}
        />
      ) : (
        <div className="warning-panel">
          <strong>目前暫不接受新訂單</strong>
          <ul>
            {readiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>安全檢查未通過時，不會開始 72 小時契約流程或保留直播名額。</p>
        </div>
      )}
    </section>
  );
}
