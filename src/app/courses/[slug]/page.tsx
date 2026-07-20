import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlay,
  Clock3,
  FileCheck2,
  MonitorPlay,
  ShieldCheck,
  Users,
} from "lucide-react";
import { CourseVisual } from "@/components/course-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { formatPrice } from "@/lib/data";
import { getPublicCourse } from "@/lib/course-repository";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const course = await getPublicCourse((await params).slug);
  return { title: course?.title ?? "課程" };
}

export default async function CourseDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const course = await getPublicCourse((await params).slug);
  if (!course) notFound();
  return (
    <>
      <SiteHeader />
      <main>
        <section className="bg-[#3C260F] text-white">
          <div className="page-shell py-5 text-xs font-bold text-[#CBB79F]">
            <Link href="/courses">全部課程</Link>
            <ChevronRight className="mx-1 inline size-3" />
            {course.category}
          </div>
          <div className="page-shell grid gap-10 pb-14 pt-5 lg:grid-cols-[1fr_420px] lg:items-center lg:pb-16">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-[#F5C060]/15 px-3 py-1.5 text-xs font-black text-[#FDE8BC]">
                  {course.accredited
                    ? `正式長照積分 ${course.accreditationPoints ?? course.credits} 點`
                    : "非長照積分課程"}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black">
                  {course.delivery === "live" ? "網站內同步直播" : "錄播課程"}
                </span>
              </div>
              <h1 className="mt-5 max-w-3xl text-3xl font-black leading-tight tracking-[-.04em] sm:text-5xl">
                {course.title}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#E8D9C7]">
                {course.subtitle}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-bold text-[#D6C3AD]">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="size-5" />
                  {course.duration}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MonitorPlay className="size-5" />
                  {course.lessons}{" "}
                  {course.delivery === "live" ? "個場次" : "個單元"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BadgeCheck className="size-5" />
                  測驗 {course.passScore ?? 80} 分及格
                </span>
              </div>
              <div className="mt-7 flex items-center gap-3">
                <div className="grid size-12 place-items-center rounded-full bg-[#B45309] font-black">
                  歲
                </div>
                <div>
                  <p className="font-black">{course.instructor}</p>
                  <p className="text-sm text-[#BDA78F]">
                    {course.instructorRole}
                  </p>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white text-[#302318] shadow-2xl">
              <CourseVisual course={course} compact />
              <div className="p-6">
                <p className="rounded-xl bg-[#FFF8ED] p-3 text-sm font-black text-[#694115]">
                  一次付清・
                  {course.delivery === "live"
                    ? "權限只適用購買的指定場次・不提供回放"
                    : "購買後永久觀看"}
                  {course.accredited ? "・須完成積分身分驗證" : ""}
                </p>
                <div className="mt-4 flex items-end gap-3">
                  <p className="text-3xl font-black">
                    {formatPrice(course.price)}
                  </p>
                  <p className="pb-1 text-sm text-slate-500">單堂售價</p>
                </div>
                {course.delivery === "live" ? (
                  <a
                    className="button-primary button-large mt-5 w-full"
                    href="#live-sessions"
                  >
                    選擇直播場次
                  </a>
                ) : (
                  <Link
                    className="button-primary button-large mt-5 w-full"
                    href={`/checkout/${course.slug}`}
                  >
                    登入並前往付款
                  </Link>
                )}
                <Link
                  className="button-secondary mt-3 w-full"
                  href="/login?next=/dashboard"
                >
                  <CirclePlay className="size-5" />
                  已購買？前往我的學習
                </Link>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#F0E7DB] pt-5 text-xs font-bold text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-[#B45309]" />
                    伺服器確認付款
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <FileCheck2 className="size-4 text-[#B45309]" />
                    人工退款審核
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="page-shell grid gap-12 py-14 lg:grid-cols-[1fr_330px] lg:py-20">
          <div>
            <h2 className="text-2xl font-black text-[#302318]">
              這堂課你會學到
            </h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {course.outcomes.map((outcome) => (
                <div
                  key={outcome}
                  className="flex gap-3 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold leading-6 text-[#57483A]"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#B45309] text-white">
                    <Check className="size-3" />
                  </span>
                  {outcome}
                </div>
              ))}
            </div>
            <h2 className="mt-12 text-2xl font-black text-[#302318]">
              課程介紹
            </h2>
            <p className="mt-5 leading-8 text-[#6F5E4E]">
              {course.description}
            </p>
            {course.delivery === "live" ? (
              <div id="live-sessions">
                <h2 className="mt-12 text-2xl font-black text-[#302318]">
                  選擇直播場次
                </h2>
                <div className="mt-5 grid gap-4">
                  {course.liveSessions
                    ?.filter((session) => session.status === "open")
                    .map((session) => (
                      <article
                        key={session.id}
                        className="rounded-2xl border border-[#EADFCF] bg-white p-5"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
                            <CalendarDays />
                          </span>
                          <div className="flex-1">
                            <h3 className="font-black text-[#302318]">
                              {session.title}
                            </h3>
                            <p className="mt-2 text-sm font-bold text-slate-500">
                              {formatLiveDate(session.startsAt, session.endsAt)}
                              ・{session.instructorName}
                            </p>
                            <p className="mt-2 text-xs font-bold text-slate-500">
                              <Users className="mr-1 inline size-4" />
                              剩餘{" "}
                              {Math.max(
                                0,
                                session.capacity - session.sold,
                              )} / {session.capacity} 席
                            </p>
                          </div>
                          <Link
                            className="button-primary min-h-11"
                            href={`/checkout/${course.slug}?session=${session.id}`}
                          >
                            選擇此場
                          </Link>
                        </div>
                      </article>
                    ))}
                  {!course.liveSessions?.some(
                    (session) => session.status === "open",
                  ) && (
                    <p className="rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
                      目前沒有開放販售的直播場次。
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <h2 className="mt-12 text-2xl font-black text-[#302318]">
                  課程單元
                </h2>
                <div className="mt-5 overflow-hidden rounded-2xl border border-[#EADFCF]">
                  {course.chapters.map((chapter, index) => (
                    <div
                      key={chapter.title}
                      className="flex items-center gap-4 p-5"
                    >
                      <span className="grid size-9 place-items-center rounded-full bg-[#FFF0D5] text-xs font-black text-[#8A4800]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="min-w-0 flex-1 font-bold">
                        {chapter.title}
                      </p>
                      <span className="text-xs font-bold text-slate-400">
                        {chapter.duration}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <aside>
            <div className="sticky top-24 rounded-2xl border border-[#F1D5A8] bg-[#FFF8ED] p-6">
              <BadgeCheck className="size-8 text-[#B45309]" />
              <h3 className="mt-4 text-lg font-black text-[#302318]">
                取得{course.accredited ? "積分" : "完課"}證明的條件
              </h3>
              <ul className="mt-4 space-y-3 text-sm font-semibold leading-6 text-[#6F5E4E]">
                {course.delivery === "live" ? (
                  <>
                    <li>・完成場次簽到與簽退</li>
                    <li>・扣除休息後，鏡頭有效時數達 80%</li>
                  </>
                ) : (
                  <>
                    <li>・有效觀看達 {course.completionPercent ?? 90}%</li>
                    <li>・正式環境每 15 分鐘完成在席確認</li>
                  </>
                )}
                <li>・課後測驗達 {course.passScore ?? 80} 分，可補考</li>
                <li>・完成滿意度調查</li>
                {course.accredited && <li>・積分身分資料通過管理員驗證</li>}
              </ul>
              <p className="mt-5 rounded-xl bg-white p-3 text-xs leading-5 text-slate-500">
                {course.accredited
                  ? `核定字號：${course.accreditationNumber ?? "核定資料待確認"}。只有全部資格通過才會發正式證明。`
                  : "本課只發歲悅學苑完課證明，不申報長照積分。"}
              </p>
            </div>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function formatLiveDate(start: string, end: string) {
  return `${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(start))}–${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`;
}
