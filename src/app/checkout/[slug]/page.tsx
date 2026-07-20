import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import { CheckoutButton } from "@/components/checkout-button";
import { Brand } from "@/components/site-header";
import { formatPrice } from "@/lib/data";
import { getPublicCourse } from "@/lib/course-repository";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const course = await getPublicCourse((await params).slug);
  if (!course) notFound();
  const liveSessionId = (await searchParams).session;
  const liveSession = liveSessionId
    ? course.liveSessions?.find(
        (session) => session.id === liveSessionId && session.status === "open",
      )
    : undefined;
  if (course.delivery === "live" && !liveSession) notFound();
  let authenticated = false;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase!.auth.getClaims();
    authenticated = typeof data?.claims?.sub === "string";
    if (!authenticated)
      redirect(
        `/login?next=${encodeURIComponent(`/checkout/${course.slug}${liveSessionId ? `?session=${liveSessionId}` : ""}`)}`,
      );
  }
  return (
    <main className="min-h-screen bg-[#FFF8ED] py-8">
      <div className="page-shell">
        <Brand />
        <div className="mx-auto mt-10 grid max-w-4xl overflow-hidden rounded-3xl border border-[#EADFCF] bg-white shadow-xl lg:grid-cols-[1fr_360px]">
          <section className="p-6 sm:p-10">
            <p className="section-kicker">CHECKOUT</p>
            <h1 className="mt-3 text-3xl font-black text-[#302318]">
              確認課程訂單
            </h1>
            <p className="mt-3 leading-7 text-slate-500">
              付款頁會離開歲悅學苑前往綠界；請在同一個分頁完成，不要關閉或另開視窗。
            </p>
            <div className="mt-7 rounded-2xl border border-[#EADFCF] p-5">
              <p className="text-sm font-black text-[#B45309]">
                {course.delivery === "live"
                  ? "網站內同步直播課"
                  : course.accredited
                    ? "正式錄播積分課"
                    : "線上錄播課程"}
              </p>
              <h2 className="mt-2 text-xl font-black text-[#302318]">
                {course.title}
              </h2>
              {liveSession && (
                <div className="mt-4 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold text-[#694115]">
                  <CalendarDays className="mr-2 inline size-5" />
                  {liveSession.title}
                  <br />
                  <span className="ml-7 text-xs text-slate-500">
                    {formatLiveDate(liveSession.startsAt, liveSession.endsAt)}・
                    {liveSession.instructorName}
                  </span>
                </div>
              )}
              <p className="mt-2 text-sm text-slate-500">
                {course.duration}・
                {course.accredited
                  ? `${course.accreditationPoints ?? course.credits} 積分`
                  : "非長照積分"}
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-[#F0E7DB] pt-5">
                <span className="font-bold text-slate-500">應付金額</span>
                <span className="text-2xl font-black">
                  {formatPrice(course.price)}
                </span>
              </div>
            </div>
            <div className="mt-6 space-y-3 text-sm font-bold text-[#6F5E4E]">
              <p className="flex gap-2">
                <CheckCircle2 className="size-5 text-[#B45309]" />
                一次付清，
                {course.delivery === "live"
                  ? "只適用這個指定場次，不提供回放"
                  : "購買後永久觀看"}
              </p>
              <p className="flex gap-2">
                <ShieldCheck className="size-5 text-[#B45309]" />
                只有綠界伺服器通知成功才會正式占位
              </p>
              {course.accredited && (
                <p className="flex gap-2">
                  <FlaskConical className="size-5 text-[#B45309]" />
                  付款後須完成積分身分資料與審核
                </p>
              )}
            </div>
          </section>
          <aside className="bg-[#FFF8ED] p-6 sm:p-8">
            <h2 className="text-lg font-black text-[#302318]">付款摘要</h2>
            <div className="mt-5 flex justify-between text-sm">
              <span>課程售價</span>
              <strong>{formatPrice(course.price)}</strong>
            </div>
            <div className="mt-3 flex justify-between text-sm">
              <span>手續費</span>
              <strong>NT$0</strong>
            </div>
            <div className="my-5 border-t border-[#E4D4BE]" />
            <div className="flex justify-between">
              <span className="font-black">合計</span>
              <strong className="text-xl">{formatPrice(course.price)}</strong>
            </div>
            <div className="mt-7">
              {authenticated ? (
                <CheckoutButton
                  courseSlug={course.slug}
                  liveSessionId={liveSessionId}
                />
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
                  Supabase 尚未設定，因此只能預覽結帳頁，不能建立訂單。
                </div>
              )}
            </div>
            <Link
              className="button-ghost mt-3 w-full"
              href={`/courses/${course.slug}`}
            >
              返回課程介紹
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}

function formatLiveDate(start: string, end: string) {
  return `${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(start))}–${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`;
}
