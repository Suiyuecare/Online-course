import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { BadgeCheck, CircleX } from "lucide-react";
import { PrintCertificateButton } from "@/components/print-certificate-button";
import { appOrigin } from "@/lib/env";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "完課證明驗證",
  robots: { index: false, follow: false, noarchive: true },
};
function maskName(name: string) {
  if (!name) return "歲悅學員";
  return name.length <= 2
    ? `${name[0]}○`
    : `${name[0]}${"○".repeat(name.length - 2)}${name.at(-1)}`;
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const demo = code === "demo";
  const admin = createSupabaseAdminClient();
  let data = {
    code: "DEMO-SUIYUE-2026",
    learner: "歲悅學員",
    title: "失智照護入門：看見行為背後的需要",
    issuedAt: "2026-07-19T00:00:00.000Z",
    revoked: false,
    owner: true,
    kind: "completion",
    approvalNumber: "",
    points: 0,
    authority: "",
    sessionDate: "",
    attendanceThreshold: 0,
  };
  if (!demo) {
    if (!admin) notFound();
    const { data: certificate } = await admin!
      .from("certificates")
      .select(
        "learner_id,enrollment_id,verification_code,issued_at,revoked_at,certificate_kind,accreditation_number_snapshot,accreditation_points_snapshot,accreditation_authority_snapshot,live_session_date_snapshot,attendance_threshold_snapshot",
      )
      .eq("verification_code", code)
      .maybeSingle();
    if (!certificate) notFound();
    const { data: enrollment } = await admin!
      .from("enrollments")
      .select("course_id")
      .eq("id", certificate.enrollment_id)
      .single();
    const [{ data: profile }, { data: course }, viewerId] = await Promise.all([
      admin!
        .from("profiles")
        .select("full_name")
        .eq("id", certificate.learner_id)
        .maybeSingle(),
      admin!
        .from("courses")
        .select("title")
        .eq("id", enrollment!.course_id)
        .single(),
      getAuthenticatedUserId(),
    ]);
    data = {
      code: certificate.verification_code,
      learner:
        viewerId === certificate.learner_id
          ? profile?.full_name || "歲悅學員"
          : maskName(profile?.full_name || "歲悅學員"),
      title: course?.title ?? "歲悅學苑課程",
      issuedAt: certificate.issued_at,
      revoked: Boolean(certificate.revoked_at),
      owner: viewerId === certificate.learner_id,
      kind: certificate.certificate_kind,
      approvalNumber: certificate.accreditation_number_snapshot ?? "",
      points: Number(certificate.accreditation_points_snapshot ?? 0),
      authority: certificate.accreditation_authority_snapshot ?? "",
      sessionDate: certificate.live_session_date_snapshot ?? "",
      attendanceThreshold: Number(
        certificate.attendance_threshold_snapshot ?? 0,
      ),
    };
  }
  const verifyUrl = `${appOrigin()}/certificate/${encodeURIComponent(data.code)}`;
  const qr = await QRCode.toDataURL(verifyUrl, {
    width: 220,
    margin: 1,
    color: { dark: "#5C3800", light: "#FFFFFF" },
  });
  const formal = data.kind === "accreditation";
  return (
    <main className="min-h-screen bg-[#EFE8DE] px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto mb-5 flex max-w-4xl items-center justify-between print:hidden">
        <Link href="/" className="font-black text-[#694115]">
          ← 歲悅學苑
        </Link>
        <PrintCertificateButton />
      </div>
      <article className="relative mx-auto max-w-4xl overflow-hidden border-[10px] border-[#FFF8ED] bg-white p-8 shadow-2xl outline outline-1 outline-[#D6B681] sm:p-14 print:shadow-none">
        <div className="absolute -right-20 -top-20 size-64 rounded-full bg-[#EA880C]/10" />
        <div className="absolute -bottom-24 -left-20 size-64 rounded-full bg-[#F5C060]/15" />
        {demo && (
          <div className="absolute inset-0 z-10 grid place-items-center text-6xl font-black -rotate-20 text-[#B45309]/10">
            證明樣張
          </div>
        )}
        <header className="relative flex items-center justify-between border-b border-[#EADFCF] pb-7">
          <div className="flex items-center gap-3">
            <Image
              src="/suiyue-milk.png"
              alt="歲悅牛奶盒 Logo"
              width={58}
              height={58}
            />
            <div>
              <p className="text-2xl font-black text-[#302318]">歲悅學苑</p>
              <p className="mt-1 text-xs font-bold tracking-[.18em] text-[#B45309]">
                SUIYUE ACADEMY
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${data.revoked ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
          >
            {data.revoked ? (
              <CircleX className="size-4" />
            ) : (
              <BadgeCheck className="size-4" />
            )}
            {data.revoked ? "已撤銷" : "驗證有效"}
          </span>
        </header>
        <div className="relative py-12 text-center">
          <p className="text-sm font-black tracking-[.32em] text-[#B45309]">
            {formal ? "積 分 完 課 證 明" : "完 課 證 明"}
          </p>
          <h1 className="mt-6 text-4xl font-black tracking-[-.04em] text-[#302318] sm:text-5xl">
            Certificate of Completion
          </h1>
          <p className="mt-10 text-lg leading-8 text-slate-500">茲證明</p>
          <p className="mt-3 text-3xl font-black text-[#5C3800]">
            {data.learner}
          </p>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-slate-600">
            已完成歲悅學苑{formal ? "正式積分" : "非積分"}課程
            <br />
            <strong className="text-xl text-[#302318]">「{data.title}」</strong>
            <br />
            並符合
            {data.sessionDate ? "指定直播場次簽到退、有效鏡頭出席" : "有效觀看"}
            、課後測驗及滿意度條件。
          </p>
          {formal && (
            <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-2 text-sm font-bold text-[#694115]">
              <span className="rounded-full bg-[#FFF8ED] px-3 py-1.5">
                核定字號：{data.approvalNumber}
              </span>
              <span className="rounded-full bg-[#FFF8ED] px-3 py-1.5">
                積分：{data.points}
              </span>
              {data.authority && (
                <span className="rounded-full bg-[#FFF8ED] px-3 py-1.5">
                  核定單位：{data.authority}
                </span>
              )}
              {data.sessionDate && (
                <span className="rounded-full bg-[#FFF8ED] px-3 py-1.5">
                  場次日期：{data.sessionDate}・鏡頭門檻：
                  {data.attendanceThreshold}%
                </span>
              )}
            </div>
          )}
          <p className="mt-7 text-sm font-bold text-slate-500">
            發證日期：
            {new Intl.DateTimeFormat("zh-TW", {
              dateStyle: "long",
              timeZone: "Asia/Taipei",
            }).format(new Date(data.issuedAt))}
          </p>
        </div>
        <footer className="relative grid gap-6 border-t border-[#EADFCF] pt-7 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-xs font-black text-[#B45309]">公開驗證碼</p>
            <p className="mt-2 break-all font-mono text-sm font-bold text-[#57483A]">
              {data.code}
            </p>
            <p className="mt-3 max-w-lg text-xs leading-5 text-slate-400">
              {formal
                ? "本證明依發證當下的核定資料產生；掃描 QR Code 可確認證明與撤銷狀態。"
                : "此證明不代表長照繼續教育積分。"}
              退款後證明與觀看權限得撤銷，稽核紀錄仍保留。
            </p>
            {!data.owner && (
              <p className="mt-2 text-xs font-bold text-slate-400">
                公開驗證頁已遮蔽學員姓名。
              </p>
            )}
          </div>
          <Image
            src={qr}
            alt="完課證明公開驗證 QR Code"
            width={132}
            height={132}
            unoptimized
          />
        </footer>
      </article>
    </main>
  );
}
