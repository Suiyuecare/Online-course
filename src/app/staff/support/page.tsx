import { redirect } from "next/navigation";
import { z } from "zod";
import { readSlaWorkspace } from "@/application/operations-v2";
import { readSupportQueue } from "@/application/workspace";
import { SlaWorkspacePanel } from "@/components/sla-workspace-panel";
import { SupportQueue } from "@/components/support-queue";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffSupportPage({
  searchParams,
}: {
  searchParams: Promise<{
    slaDeadline?: string;
    slaReference?: string;
  }>;
}) {
  const filters = await searchParams;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const workspace = await readSupportQueue(supabase).catch(() => null);
  if (!workspace) redirect("/staff/security");
  const cursor = z
    .object({
      deadlineAt: z.string().datetime({ offset: true }),
      reference: z.string().regex(/^SUP-[A-F0-9]{12}$/),
    })
    .safeParse({
      deadlineAt: filters.slaDeadline,
      reference: filters.slaReference,
    });
  const slaWorkspace = await readSlaWorkspace(supabase, "support", {
    cursor: cursor.success ? cursor.data : undefined,
    limit: 50,
  }).catch(() => null);

  return (
    <section className="page-shell shell">
      <p className="eyebrow">客服工作台</p>
      <h1>遮罩案件佇列</h1>
      <p className="lead">
        先指派承辦人，承辦人才能讀取該案件對話並執行回覆、狀態與 SLA
        動作。所有動作都會新增不可覆寫事件與稽核。
      </p>
      {slaWorkspace ? (
        <SlaWorkspacePanel
          nextHref={
            slaWorkspace.nextCursor
              ? `/staff/support?${new URLSearchParams({
                  slaDeadline: slaWorkspace.nextCursor.deadlineAt,
                  slaReference: slaWorkspace.nextCursor.reference,
                }).toString()}`
              : undefined
          }
          title="客服案件 SLA"
          workspace={slaWorkspace}
        />
      ) : (
        <div className="warning-panel">
          <strong>客服 SLA 投影暫時無法使用</strong>
          <p>案件內容仍維持遮罩與承辦人授權；系統不會用直接資料表查詢降級。</p>
        </div>
      )}
      <SupportQueue workspace={workspace} />
    </section>
  );
}
