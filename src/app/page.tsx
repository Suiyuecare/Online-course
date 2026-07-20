import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CirclePlay,
  Clock3,
  FileBadge2,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { CourseCard, CourseVisual } from "@/components/course-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { pilotCourse } from "@/lib/data";

const steps = [
  [
    "01",
    "快速登入",
    "使用 Google 或 Email 六位數驗證碼，不用記密碼。",
    KeyRound,
  ],
  [
    "02",
    "安心學習",
    "付款確認後開放影片，續播與有效觀看時間自動保存。",
    CirclePlay,
  ],
  [
    "03",
    "完成證明",
    "通過 80 分測驗並填寫滿意度，取得附 QR 的完課證明。",
    FileBadge2,
  ],
] as const;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero-grid overflow-hidden bg-[#FFF8ED]">
          <div className="page-shell grid min-h-[660px] items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
            <div className="relative z-10">
              <div className="eyebrow">
                <Sparkles className="size-4" /> 歲悅學苑封閉試營運
              </div>
              <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[1.16] tracking-[-0.05em] text-[#302318] sm:text-5xl lg:text-[62px]">
                照顧專業，
                <br />
                <span className="text-[#B45309]">也可以學得很簡單。</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#6F5E4E]">
                一個帳號完成購課、看影片、保存進度、測驗與完課證明。第一堂 6
                分鐘失智照護測試課，陪你從最簡單的一步開始。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="button-primary button-large"
                  href={`/courses/${pilotCourse.slug}`}
                >
                  查看 NT$100 測試課 <ArrowRight className="size-5" />
                </Link>
                <Link className="button-secondary button-large" href="/login">
                  <KeyRound className="size-5" /> 登入試營運
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold text-[#6F5E4E]">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-[#B45309]" />
                  免安裝 App
                </span>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-[#B45309]" />
                  購買後永久觀看
                </span>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-[#B45309]" />
                  非積分測試課
                </span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl lg:ml-auto">
              <div className="absolute -left-5 top-12 z-20 hidden rounded-2xl border border-white bg-white p-4 shadow-xl sm:block">
                <div className="flex items-center gap-3">
                  <Image
                    src="/suiyue-milk.png"
                    alt="歲悅牛奶盒"
                    width={46}
                    height={46}
                    priority
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-500">簡單開始</p>
                    <p className="font-black text-[#4A3016]">
                      Email 六位數登入
                    </p>
                  </div>
                </div>
              </div>
              <div className="rotate-2 rounded-[30px] bg-[#B45309] p-3 shadow-2xl shadow-orange-950/20">
                <div className="overflow-hidden rounded-[22px] bg-white">
                  <CourseVisual course={pilotCourse} />
                  <div className="p-6">
                    <p className="text-xs font-black uppercase tracking-widest text-[#B45309]">
                      第一堂測試課
                    </p>
                    <h2 className="mt-2 text-xl font-black text-[#302318]">
                      {pilotCourse.title}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      6 分鐘・中文字幕・非長照積分
                    </p>
                    <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[#FFF0D5]">
                      <div className="h-full w-[34%] rounded-full bg-[#EA880C]" />
                    </div>
                    <div className="mt-2 flex justify-between text-xs font-bold text-slate-500">
                      <span>進度會自動保存</span>
                      <span>可隨時續播</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-7 right-2 z-20 rounded-2xl border border-white bg-white p-4 shadow-xl">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
                    <Clock3 className="size-6" />
                  </span>
                  <div>
                    <p className="font-black text-[#302318]">2 分鐘在席確認</p>
                    <p className="text-xs font-semibold text-slate-500">
                      試營運方便快速驗證
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#F0E7DB] bg-white">
          <div className="page-shell grid divide-y divide-[#F0E7DB] py-8 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Trust value="六位數" label="Email 一次性驗證碼" />
            <Trust value="80 分" label="課後測驗及格門檻" />
            <Trust value="永久" label="購買後觀看期限" />
          </div>
        </section>

        <section className="page-shell py-20 sm:py-24">
          <div className="section-heading-row">
            <div>
              <p className="section-kicker">封閉測試課程</p>
              <h2 className="section-title">先把一條學習流程做好</h2>
              <p className="section-lead">
                用真實登入、測試金流和受保護影音驗證完整體驗；沒有設定外部服務時，系統會安全拒絕，不會誤開課程權限。
              </p>
            </div>
          </div>
          <div className="mt-10 max-w-sm">
            <CourseCard course={pilotCourse} />
          </div>
        </section>

        <section className="bg-[#5C3800] py-20 text-white sm:py-24">
          <div className="page-shell">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-black tracking-[.18em] text-[#F5C060]">
                三個清楚步驟
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
                不熟 3C，也能自己完成
              </h2>
              <p className="mt-4 text-lg leading-8 text-[#FDE8BC]">
                每個主要按鈕都夠大、文字直接，遇到設定未完成也會告訴你下一步。
              </p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {steps.map(([number, title, text, Icon]) => (
                <div
                  key={number}
                  className="relative rounded-2xl border border-white/10 bg-white/[.07] p-6"
                >
                  <span className="absolute right-5 top-4 text-3xl font-black text-white/10">
                    {number}
                  </span>
                  <span className="grid size-12 place-items-center rounded-xl bg-[#F5C060] text-[#5C3800]">
                    <Icon className="size-6" />
                  </span>
                  <h3 className="mt-5 text-xl font-black">{title}</h3>
                  <p className="mt-3 leading-7 text-[#FDE8BC]">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="page-shell py-20 sm:py-24">
          <div className="rounded-[30px] border border-[#F1D5A8] bg-[#FFF8ED] p-7 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-12">
            <div>
              <div className="eyebrow bg-white">
                <ShieldCheck className="size-4" /> 本課不申報長照積分
              </div>
              <h2 className="mt-5 text-3xl font-black tracking-[-.04em] text-[#302318]">
                完成後取得「歲悅學苑完課證明」
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-[#6F5E4E]">
                證明附公開驗證網址與 QR
                Code；退款後會撤銷觀看權限，訂單與學習稽核紀錄仍會保留。
              </p>
            </div>
            <Link
              className="button-primary button-large mt-7 shrink-0 lg:mt-0"
              href={`/courses/${pilotCourse.slug}`}
            >
              開始測試 <ArrowRight className="size-5" />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Trust({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-6 py-5">
      <p className="text-2xl font-black text-[#B45309]">{value}</p>
      <p className="text-sm font-bold text-slate-500">{label}</p>
    </div>
  );
}
