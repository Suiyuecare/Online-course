import { ZoomClassroom } from "@/components/zoom-classroom";

export const dynamic = "force-dynamic";

export default async function LiveClassroomPage({
  params,
}: {
  params: Promise<{ liveSessionId: string }>;
}) {
  const { liveSessionId } = await params;
  return (
    <section className="classroom-page shell">
      <p className="eyebrow">線上同步課程</p>
      <h1>同步教室</h1>
      <a
        className="button secondary"
        href={`/api/live/${liveSessionId}/calendar`}
      >
        下載行事曆（.ics）
      </a>
      <ZoomClassroom liveSessionId={liveSessionId} />
    </section>
  );
}
