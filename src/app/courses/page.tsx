import { FlaskConical, Search } from "lucide-react";
import { CourseCard } from "@/components/course-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { comingSoonCourses } from "@/lib/data";
import { getPublicCourses } from "@/lib/course-repository";

export default async function CoursesPage() {
  const publishedCourses = await getPublicCourses();
  return (
    <>
      <SiteHeader />
      <main className="bg-[#FFFDF9]">
        <section className="border-b border-[#EADFCF] bg-[#FFF8ED] py-12 sm:py-16">
          <div className="page-shell">
            <p className="section-kicker">COURSE CATALOG</p>
            <h1 className="section-title">歲悅學苑課程</h1>
            <p className="section-lead">
              從非積分測試課、正式錄播積分課到同步直播，都使用同一個帳號保存購課、出席、測驗與證明紀錄。
            </p>
            <div className="mt-7 flex max-w-2xl items-center gap-3 rounded-2xl border border-[#D6C5AD] bg-white p-2 shadow-sm focus-within:border-[#EA880C] focus-within:ring-4 focus-within:ring-[#FDE8BC]">
              <Search className="ml-2 size-5 text-slate-400" />
              <input
                className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-1 py-2 outline-none"
                placeholder="搜尋歲悅課程"
                aria-label="搜尋課程"
              />
              <button className="button-primary">搜尋</button>
            </div>
          </div>
        </section>
        <section className="page-shell py-14 sm:py-18">
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-[#F1D5A8] bg-[#FFF8ED] p-4 text-sm font-bold text-[#694115]">
            <FlaskConical className="size-5 shrink-0 text-[#B45309]" />
            封閉測試的付款、影片、Zoom 與 Email
            服務需要管理員先完成外部金鑰設定；未設定時會顯示清楚提示。
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {publishedCourses.map((course) => (
              <CourseCard key={course.slug} course={course} />
            ))}
          </div>
          <div className="mt-16">
            <p className="section-kicker">NEXT PHASE</p>
            <h2 className="mt-2 text-2xl font-black text-[#302318]">
              下一階段課程
            </h2>
            <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {comingSoonCourses.map((course) => (
                <CourseCard key={course.slug} course={course} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
