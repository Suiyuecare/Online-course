import { notFound, redirect } from "next/navigation";
import { readStaffLiveSessionContext } from "@/application/workspace";
import { LiveSessionManagementPanel } from "@/components/live-session-management-panel";
import { ZoomHostConsole } from "@/components/zoom-host-console";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function HostPage({
  params,
}: {
  params: Promise<{ liveSessionId: string }>;
}) {
  const { liveSessionId } = await params;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  let context;
  try {
    context = await readStaffLiveSessionContext(supabase, liveSessionId);
  } catch {
    notFound();
  }
  return (
    <main className="classroom-page shell">
      <p className="eyebrow">主持人專用</p>
      <h1>{context.title}</h1>
      <p className="lead">場次狀態：{context.status}</p>
      {context.canHost && <ZoomHostConsole liveSessionId={liveSessionId} />}
      <LiveSessionManagementPanel
        liveSessionId={liveSessionId}
        initialBreaks={context.breakIntervals}
        startsAt={context.startsAt}
        endsAt={context.endsAt}
        bookingCloseAt={context.bookingCloseAt}
        canEditBreaks={context.canEditBreaks}
        canSettle={context.canSettle}
        canReschedule={context.canReschedule}
      />
    </main>
  );
}
