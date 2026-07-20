import Image from "next/image";
import Link from "next/link";
import { Menu, Search } from "lucide-react";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5"
      aria-label="歲悅學苑首頁"
    >
      <span
        className={`grid size-11 place-items-center overflow-hidden rounded-xl ${inverse ? "bg-white" : "bg-[#FFF8ED]"}`}
      >
        <Image
          src="/suiyue-milk.png"
          alt="歲悅牛奶盒 Logo"
          width={44}
          height={44}
          priority
        />
      </span>
      <span
        className={`text-xl font-black tracking-[-0.04em] ${inverse ? "text-white" : "text-[#3A2A1A]"}`}
      >
        歲悅學苑
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#EADFCF] bg-white/95 backdrop-blur">
      <div className="page-shell flex h-18 items-center gap-5">
        <Brand />
        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label="主要選單"
        >
          <Link className="nav-link" href="/courses">
            探索課程
          </Link>
          <Link className="nav-link" href="/certificate/demo">
            驗證完課證明
          </Link>
          <Link className="nav-link" href="/enterprise">
            機構培訓
          </Link>
          <span className="nav-link cursor-default text-slate-400">
            同步直播・封閉測試
          </span>
        </nav>
        <Link
          href="/courses"
          className="ml-auto hidden h-11 min-w-56 items-center gap-2 rounded-xl border border-[#EADFCF] bg-[#FFF8ED] px-3 text-sm text-[#76685B] md:flex"
        >
          <Search className="size-4" /> 搜尋歲悅課程
        </Link>
        <div className="hidden items-center gap-2 sm:flex">
          <Link className="button-ghost" href="/login">
            登入
          </Link>
          <Link className="button-primary" href="/login">
            使用 Email 登入
          </Link>
        </div>
        <Link
          className="ml-auto grid size-11 place-items-center rounded-xl border border-[#EADFCF] sm:hidden"
          href="/courses"
          aria-label="開啟課程選單"
        >
          <Menu className="size-5" />
        </Link>
      </div>
    </header>
  );
}

export function DashboardHeader({
  context,
}: {
  context: "learner" | "enterprise" | "admin";
}) {
  const contextName =
    context === "learner"
      ? "我的學習"
      : context === "enterprise"
        ? "機構培訓工作台"
        : "營運管理後台";
  return (
    <header className="border-b border-[#EADFCF] bg-white">
      <div className="page-shell flex min-h-18 items-center gap-4 py-3">
        <Brand />
        <span className="hidden h-6 w-px bg-[#EADFCF] sm:block" />
        <span className="hidden text-sm font-bold text-slate-500 sm:inline">
          {contextName}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/"
            className="hidden text-sm font-bold text-[#8A5A22] md:flex"
          >
            回前台
          </Link>
          <span
            className="grid size-10 place-items-center rounded-full bg-[#FFF0D5] text-sm font-black text-[#8A4800]"
            aria-label="目前使用者"
          >
            歲
          </span>
        </div>
      </div>
    </header>
  );
}
