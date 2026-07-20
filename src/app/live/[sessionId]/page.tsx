import Link from "next/link";
import { Radio } from "lucide-react";
import { LiveClassroom } from "@/components/live-classroom";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

export default async function LivePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (process.env.FEATURE_LIVE_COURSES !== "true")
    return (
      <Gate
        title="同步教室尚未啟用"
        text="完成 Zoom、Supabase 與直播加密金鑰設定後，將 FEATURE_LIVE_COURSES 開啟即可進行內部測試。"
      />
    );
  const userId = await getAuthenticatedUserId();
  if (!userId)
    return (
      <Gate
        title="請先登入歲悅學苑"
        text="學員不需 Zoom 帳號，但必須先用購課時的歲悅帳號登入。"
        href={`/login?next=/live/${sessionId}`}
        action="前往登入"
      />
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return (
      <Gate
        title="直播服務尚未設定"
        text="資料庫服務目前無法使用，系統不會提供會議資訊。"
      />
    );
  const { data: booking } = await admin
    .from("live_session_bookings")
    .select(
      "id,status,enrollment_id,live_sessions(id,title,instructor_name,starts_at,ends_at,status,camera_required_percent,courses(title)),live_attendance_summaries(checked_in_at,checked_out_at,camera_seconds,required_seconds,camera_percent,attendance_status,reasons)",
    )
    .eq("learner_id", userId)
    .eq("live_session_id", sessionId)
    .eq("status", "confirmed")
    .maybeSingle();
  const session =
    booking &&
    (Array.isArray(booking.live_sessions)
      ? booking.live_sessions[0]
      : booking.live_sessions);
  const course =
    session &&
    (Array.isArray(session.courses) ? session.courses[0] : session.courses);
  const summary =
    booking &&
    (Array.isArray(booking.live_attendance_summaries)
      ? booking.live_attendance_summaries[0]
      : booking.live_attendance_summaries);
  if (!booking || !session || !course)
    return (
      <Gate
        title="沒有這個場次的入場權限"
        text="直播課權限只適用於購買的指定場次，不能加入同課程的其他梯次。"
        href="/dashboard"
        action="返回我的學習"
      />
    );
  if (session.status === "cancelled")
    return (
      <Gate
        title="這個場次已取消"
        text="原始訂單與出席紀錄已保留，請洽客服辦理人工轉班或退款。"
        href="/dashboard"
        action="返回我的學習"
      />
    );
  return (
    <LiveClassroom
      session={{
        id: session.id,
        title: session.title,
        courseTitle: course.title,
        instructorName: session.instructor_name,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        cameraRequiredPercent: Number(session.camera_required_percent ?? 80),
        status: session.status,
      }}
      initialSummary={summary}
    />
  );
}

function Gate({
  title,
  text,
  href = "/courses",
  action = "查看課程",
}: {
  title: string;
  text: string;
  href?: string;
  action?: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#FFF8ED] p-5">
      <div className="max-w-xl rounded-3xl border border-[#EADFCF] bg-white p-9 text-center shadow-xl">
        <span className="mx-auto grid size-18 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]">
          <Radio className="size-9" />
        </span>
        <p className="section-kicker mt-6">LIVE CLASSROOM</p>
        <h1 className="mt-3 text-3xl font-black text-[#302318]">{title}</h1>
        <p className="mt-4 leading-7 text-slate-500">{text}</p>
        <Link className="button-primary mt-7" href={href}>
          {action}
        </Link>
      </div>
    </main>
  );
}
