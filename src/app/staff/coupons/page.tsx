import Link from "next/link";
import { redirect } from "next/navigation";
import { readCouponAdminWorkspace } from "@/application/workspace";
import { CouponAdminCenter } from "@/components/coupon-admin-center";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffCouponsPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const workspace = await readCouponAdminWorkspace(supabase).catch(() => null);
  if (!workspace) {
    return (
      <section className="dashboard-page shell">
        <p className="eyebrow">折扣券後台</p>
        <h1>目前無法讀取折扣券管理資料</h1>
        <p>請確認已完成 AAL2，且帳號具有平台管理員或財務權限。</p>
        <Link className="button" href="/staff/security">
          前往安全驗證
        </Link>
      </section>
    );
  }
  return (
    <section className="dashboard-page shell coupon-admin-page">
      <p className="eyebrow">平台管理</p>
      <h1>折扣券與促銷活動</h1>
      <p className="lead">
        建立草稿、雙人核准、領取上限、待付款保留與正式核銷都會留下稽核紀錄。
      </p>
      <CouponAdminCenter workspace={workspace} />
    </section>
  );
}
