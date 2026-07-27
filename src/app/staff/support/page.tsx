import { redirect } from "next/navigation";
import { readSupportQueue } from "@/application/workspace";
import { SupportQueue } from "@/components/support-queue";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffSupportPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const workspace = await readSupportQueue(supabase).catch(() => null);
  if (!workspace) redirect("/staff/security");

  return (
    <section className="page-shell shell">
      <p className="eyebrow">客服工作台</p>
      <h1>遮罩案件佇列</h1>
      <p className="lead">
        先指派承辦人，承辦人才能讀取該案件對話並執行回覆、狀態與 SLA
        動作。所有動作都會新增不可覆寫事件與稽核。
      </p>
      <SupportQueue workspace={workspace} />
    </section>
  );
}
