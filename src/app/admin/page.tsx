import Link from "next/link";
import {
  BookCopy,
  Building2,
  CloudCog,
  FileCheck2,
  LockKeyhole,
  Radio,
  ReceiptText,
  ShieldCheck,
  Video,
} from "lucide-react";
import { AdminCourseSetup } from "@/components/admin-course-setup";
import { DashboardHeader } from "@/components/site-header";
import { PILOT_COURSE_ID, PILOT_LESSON_ID } from "@/lib/env";
import { getPlatformRole, isSupabaseConfigured } from "@/lib/supabase/server";

export default async function AdminPage() {
  const role = await getPlatformRole();
  const preview = !isSupabaseConfigured();
  const canManage = role === "admin";
  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <div>
          <p className="section-kicker">CLOSED BETA CONTROL</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            歲悅學苑試營運後台
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            上傳測試影片、等待處理完成，再發布課程；客服帳號只能查看資料。
          </p>
        </div>
        {preview && (
          <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            目前未設定 Supabase，以下為後台預覽。設定金鑰並將帳號的
            app_metadata.platform_role 設為 admin 後才可操作。
          </div>
        )}
        {!preview && !canManage && (
          <div className="mt-7 rounded-2xl border border-rose-200 bg-rose-50 p-5 font-bold text-rose-800">
            <LockKeyhole className="mb-2 size-6" />
            此頁需要平台管理員權限。
          </div>
        )}
        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatusCard
            icon={<ShieldCheck />}
            name="Supabase"
            ready={Boolean(
              process.env.NEXT_PUBLIC_SUPABASE_URL &&
                process.env.SUPABASE_SECRET_KEY,
            )}
            text="帳號、訂單與學習資料"
          />
          <StatusCard
            icon={<Video />}
            name="Cloudflare Stream"
            ready={Boolean(
              process.env.CLOUDFLARE_ACCOUNT_ID &&
                process.env.CLOUDFLARE_STREAM_API_TOKEN &&
                process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
            )}
            text="錄播上傳、簽章與 webhook"
          />
          <StatusCard
            icon={<Radio />}
            name="Zoom 同步教室"
            ready={Boolean(
              process.env.ZOOM_ACCOUNT_ID &&
                process.env.ZOOM_MEETING_SDK_KEY &&
                process.env.ZOOM_WEBHOOK_SECRET_TOKEN,
            )}
            text="自動排課、免 Zoom 帳號入場"
          />
          <StatusCard
            icon={<CloudCog />}
            name="綠界測試金流"
            ready={Boolean(
              process.env.ECPAY_MERCHANT_ID &&
                process.env.ECPAY_HASH_KEY &&
                process.env.ECPAY_HASH_IV,
            )}
            text="一次付清與場次席次"
          />
          <StatusCard
            icon={<ReceiptText />}
            name="綠界電子發票"
            ready={Boolean(
              process.env.ECPAY_INVOICE_MERCHANT_ID &&
                process.env.ECPAY_INVOICE_HASH_KEY &&
                process.env.ECPAY_INVOICE_HASH_IV,
            )}
            text="統編發票、退費折讓與安全重試"
          />
        </section>
        <section className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/admin/courses"
            className="panel flex min-h-32 items-center gap-4 p-6 hover:border-[#EA880C]"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
              <BookCopy />
            </span>
            <span>
              <strong className="block text-lg font-black text-[#302318]">
                課程與積分設定
              </strong>
              <span className="mt-1 block text-sm leading-6 text-slate-500">
                建立課程、設定售價、及格分數與核定資料。
              </span>
            </span>
          </Link>
          <Link
            href="/admin/live"
            className="panel flex min-h-32 items-center gap-4 p-6 hover:border-[#EA880C]"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
              <Radio />
            </span>
            <span>
              <strong className="block text-lg font-black text-[#302318]">
                同步直播場次
              </strong>
              <span className="mt-1 block text-sm leading-6 text-slate-500">
                排課、建立 Zoom、查看名額與出席異常。
              </span>
            </span>
          </Link>
          <Link
            href="/admin/accreditation"
            className="panel flex min-h-32 items-center gap-4 p-6 hover:border-[#EA880C]"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
              <FileCheck2 />
            </span>
            <span>
              <strong className="block text-lg font-black text-[#302318]">
                積分送審工作台
              </strong>
              <span className="mt-1 block text-sm leading-6 text-slate-500">
                審核學員資料、處理異常並匯出送審名冊。
              </span>
            </span>
          </Link>
          <Link
            href="/admin/enterprise"
            className="panel flex min-h-32 items-center gap-4 p-6 hover:border-[#EA880C]"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
              <Building2 />
            </span>
            <span>
              <strong className="block text-lg font-black text-[#302318]">
                企業與機構管理
              </strong>
              <span className="mt-1 block text-sm leading-6 text-slate-500">
                審核機構、級距售價、發票異常與人工退費。
              </span>
            </span>
          </Link>
        </section>
        <section className="mt-7">
          <AdminCourseSetup
            courseId={PILOT_COURSE_ID}
            lessonId={PILOT_LESSON_ID}
            enabled={canManage}
          />
        </section>
        <section className="panel mt-7 p-6">
          <h2 className="font-black text-[#302318]">封閉試營運安全閘門</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Guard
              title="付款返回不解鎖"
              text="只有 CheckMacValue 驗證通過的 ReturnURL 通知會建立權限。"
            />
            <Guard
              title="事件不可由學員直接寫入"
              text="heartbeat、測驗與滿意度都由伺服器驗證後追加。"
            />
            <Guard
              title="有紀錄的單元不可刪除"
              text="上架新版本或下架，保留付款與學習稽核軌跡。"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusCard({
  icon,
  name,
  ready,
  text,
}: {
  icon: React.ReactNode;
  name: string;
  ready: boolean;
  text: string;
}) {
  return (
    <div className="metric-card">
      <span className="text-[#B45309] [&_svg]:size-6">{icon}</span>
      <div className="mt-4 flex items-center justify-between">
        <p className="font-black text-[#302318]">{name}</p>
        <span
          className={`size-2.5 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-400"}`}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
      <p
        className={`mt-3 text-xs font-black ${ready ? "text-emerald-700" : "text-amber-700"}`}
      >
        {ready ? "已設定" : "待設定／停用"}
      </p>
    </div>
  );
}
function Guard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl bg-[#FFF8ED] p-4">
      <p className="font-black text-[#694115]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
    </div>
  );
}
