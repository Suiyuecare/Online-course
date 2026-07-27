import { redirect } from "next/navigation";
import { readSupportCenter } from "@/application/workspace";
import { SupportCenter } from "@/components/support-center";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const workspace = await readSupportCenter(supabase).catch(() => null);
  if (!workspace) {
    return (
      <section className="page-shell narrow shell">
        <p className="eyebrow">客服中心</p>
        <h1>客服案件目前無法讀取</h1>
        <div className="warning-panel">
          <strong>資料保持關閉</strong>
          <p>系統不會改用跨學員或跨機構查詢，請稍後再試。</p>
        </div>
      </section>
    );
  }
  return (
    <section className="page-shell shell">
      <p className="eyebrow">客服中心</p>
      <h1>建立案件或查看回覆</h1>
      <SupportCenter workspace={workspace} />
    </section>
  );
}
