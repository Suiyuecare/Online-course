import Link from "next/link";
import {
  AdminLiveManager,
  type LiveCourseOption,
  type LiveSessionRow,
} from "@/components/admin-live-manager";
import { DashboardHeader } from "@/components/site-header";
import {
  createSupabaseAdminClient,
  getPlatformRole,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function AdminLivePage() {
  const role = await getPlatformRole();
  const preview = !isSupabaseConfigured();
  const staff = role === "admin" || role === "support";
  const admin = staff ? createSupabaseAdminClient() : null;
  let courses: LiveCourseOption[] = [];
  let sessions: LiveSessionRow[] = [];
  if (admin) {
    const [courseResult, sessionResult] = await Promise.all([
      admin
        .from("courses")
        .select("id,title,accredited")
        .eq("delivery", "live")
        .neq("status", "archived")
        .order("title"),
      admin
        .from("live_sessions")
        .select(
          "id,course_id,title,instructor_name,starts_at,ends_at,status,capacity,host_plan_capacity,zoom_status,camera_required_percent,courses(title,slug,accredited),live_session_bookings(id,status),live_attendance_summaries(attendance_status)",
        )
        .order("starts_at", { ascending: false }),
    ]);
    courses = (courseResult.data ?? []) as LiveCourseOption[];
    sessions = (sessionResult.data ?? []) as unknown as LiveSessionRow[];
  }
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <Link href="/admin" className="text-sm font-black text-[#B45309]">
          ← 回到後台首頁
        </Link>
        <div className="mt-5">
          <p className="section-kicker">PHASE THREE</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            同步直播場次
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            排課後自動建立 Zoom
            會議，管理名額、休息區段、即時出席狀態與異常覆核。客服只能查看，不可直接改成合格。
          </p>
        </div>
        {(!staff || preview) && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
            目前為預覽或無後台權限，外部服務不會被呼叫。
          </p>
        )}
        <div className="mt-7">
          <AdminLiveManager
            courses={courses}
            initialSessions={sessions}
            enabled={role === "admin" && !preview}
            readOnly={role !== "admin"}
          />
        </div>
      </main>
    </div>
  );
}
