import Link from "next/link";
import {
  AdminCourseManager,
  type CourseRow,
} from "@/components/admin-course-manager";
import { DashboardHeader } from "@/components/site-header";
import {
  createSupabaseAdminClient,
  getPlatformRole,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function AdminCoursesPage() {
  const role = await getPlatformRole();
  const preview = !isSupabaseConfigured();
  const enabled = role === "admin";
  let initialCourses: CourseRow[] = [];
  if (enabled && !preview) {
    const admin = createSupabaseAdminClient();
    const { data } = admin
      ? await admin
          .from("courses")
          .select(
            "id,slug,title,subtitle,delivery,status,price_twd,accredited,organizer_name,accreditation_status,accreditation_authority,accreditation_category,accreditation_number,accreditation_points,pass_score,completion_percent",
          )
          .order("updated_at", { ascending: false })
      : { data: [] };
    initialCourses = (data ?? []) as CourseRow[];
  }
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <Link href="/admin" className="text-sm font-black text-[#B45309]">
          ← 回到後台首頁
        </Link>
        <div className="mt-5">
          <p className="section-kicker">PHASE TWO</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            課程與積分設定
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            建立一般課或正式錄播積分課，設定售價、及格標準、觀看門檻、核定單位與核定字號。
          </p>
        </div>
        <div className="mt-7">
          <AdminCourseManager
            enabled={enabled}
            preview={preview}
            initialCourses={initialCourses}
          />
        </div>
      </main>
    </div>
  );
}
