import Link from "next/link";
import { AccreditationRegistrationForm } from "@/components/accreditation-registration-form";
import { DashboardHeader } from "@/components/site-header";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function AccreditationPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseSlug: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { courseSlug } = await params;
  const liveSessionId = (await searchParams).session;
  const configured = isSupabaseConfigured();
  const userId = configured ? await getAuthenticatedUserId() : null;
  const admin = userId ? createSupabaseAdminClient() : null;
  const { data: course } = admin
    ? await admin
        .from("courses")
        .select("title,accredited,accreditation_status,accreditation_authority")
        .eq("slug", courseSlug)
        .maybeSingle()
    : { data: null };
  const enabled = Boolean(userId && course?.accredited);
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="learner" />
      <main className="mx-auto w-[min(100%-1.25rem,760px)] py-8 sm:py-12">
        <Link href="/dashboard" className="text-sm font-black text-[#B45309]">
          ← 回到我的學習
        </Link>
        <div className="mt-5">
          <p className="section-kicker">FORMAL CREDIT REGISTRATION</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            積分課報名資料
          </h1>
          <p className="mt-3 leading-7 text-slate-500">
            {course?.title ?? "正式錄播積分課"}
            。資料驗證完成後，仍須符合課程核定與完課條件才會取得正式證明。
          </p>
        </div>
        {!configured && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
            目前為介面預覽，設定資料庫與個資加密金鑰後才可送出。
          </p>
        )}
        {configured && !userId && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
            請先登入並購買這門積分課。
          </p>
        )}
        <div className="mt-7">
          <AccreditationRegistrationForm
            courseSlug={courseSlug}
            liveSessionId={liveSessionId}
            enabled={enabled}
          />
        </div>
      </main>
    </div>
  );
}
