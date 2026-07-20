"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeInternalPath } from "@/lib/safe-redirect";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeInternalPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const configured = Boolean(getSupabaseBrowserClient());

  async function googleLogin() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase)
      return setMessage(
        "Supabase 尚未設定，請管理員先完成環境變數與 Google Auth 設定。",
      );
    setBusy(true);
    setMessage("");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase)
      return setMessage(
        "Supabase 尚未設定，目前只能預覽畫面，不能寄送驗證碼。",
      );
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    setStep("otp");
    setMessage("六位數驗證碼已寄出，請查看信箱。驗證碼逾期可重新寄送。");
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setMessage("Supabase 尚未設定，無法驗證登入。");
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) return setMessage("驗證碼無效或已過期，請確認後再試一次。");
    router.replace(next);
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[.9fr_1.1fr]">
      <section className="flex items-center justify-center bg-white p-6 sm:p-10">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xl font-black text-[#302318]"
          >
            <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-[#FFF8ED]">
              <Image
                src="/suiyue-milk.png"
                alt="歲悅牛奶盒 Logo"
                width={44}
                height={44}
                priority
              />
            </span>
            歲悅學苑
          </Link>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-[#B45309]"
          >
            <ArrowLeft className="size-4" />
            回到首頁
          </Link>
          <h1 className="mt-7 text-3xl font-black tracking-[-.04em] text-[#302318]">
            {step === "email" ? "歡迎來到歲悅學苑" : "輸入六位數驗證碼"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            不用設定密碼，登入後可繼續付款或接著上課。
          </p>
          <button
            type="button"
            onClick={googleLogin}
            disabled={busy}
            className="button-secondary button-large mt-7 w-full"
          >
            <span className="grid size-6 place-items-center rounded-full bg-white text-sm font-black text-blue-600 shadow">
              G
            </span>
            使用 Google 帳號登入
          </button>
          <div className="my-6 flex items-center gap-3 text-xs font-bold text-slate-400">
            <span className="h-px flex-1 bg-[#EADFCF]" />
            或使用 Email 驗證碼
            <span className="h-px flex-1 bg-[#EADFCF]" />
          </div>
          {step === "email" ? (
            <form className="space-y-4" onSubmit={sendOtp}>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#57483A]">
                  Email
                </span>
                <span className="relative block">
                  <Mail className="absolute left-3 top-3.5 size-5 text-slate-400" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="field pl-11"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </span>
              </label>
              <button
                disabled={busy}
                className="button-primary button-large w-full"
              >
                {busy ? "正在寄送…" : "寄送六位數驗證碼"}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={verifyOtp}>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#57483A]">
                  寄到 {email}
                </span>
                <span className="relative block">
                  <KeyRound className="absolute left-3 top-3.5 size-5 text-slate-400" />
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(event) =>
                      setOtp(event.target.value.replace(/\D/g, ""))
                    }
                    className="field pl-11 text-center text-2xl font-black tracking-[.35em]"
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                </span>
              </label>
              <button
                disabled={busy || otp.length !== 6}
                className="button-primary button-large w-full"
              >
                {busy ? "正在驗證…" : "驗證並登入"}
              </button>
              <button
                type="button"
                className="button-ghost w-full"
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setMessage("");
                }}
              >
                更換 Email 或重新寄送
              </button>
            </form>
          )}
          {message && (
            <p
              role="status"
              className="mt-5 rounded-xl border border-[#F1D5A8] bg-[#FFF8ED] p-3 text-sm font-bold leading-6 text-[#694115]"
            >
              {message}
            </p>
          )}
          {!configured && (
            <Link
              href="/dashboard?preview=1"
              className="button-secondary mt-4 w-full"
            >
              只預覽學員中心（不會建立權限）
            </Link>
          )}
          <p className="mt-6 text-center text-xs leading-5 text-slate-400">
            登入即表示同意服務條款與隱私權政策。Email
            信件範本需由管理員設定為顯示六位數 Token。
          </p>
        </div>
      </section>
      <section className="hidden items-center justify-center overflow-hidden bg-[#5C3800] p-12 text-white lg:flex">
        <div className="relative max-w-lg">
          <div className="absolute -left-28 -top-24 size-64 rounded-full bg-[#EA880C]/20 blur-3xl" />
          <p className="relative text-sm font-black tracking-[.2em] text-[#F5C060]">
            學習不必複雜
          </p>
          <h2 className="relative mt-5 text-4xl font-black leading-tight tracking-[-.04em]">
            一個帳號，完成每一堂專業課程。
          </h2>
          <div className="relative mt-10 space-y-5">
            <Benefit
              icon={<KeyRound />}
              text="Google 或 Email 六位數驗證碼登入"
            />
            <Benefit
              icon={<ShieldCheck />}
              text="付款由伺服器通知確認後才開課"
            />
            <Benefit
              icon={<CheckCircle2 />}
              text="進度、測驗與完課證明自動保存"
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 font-bold text-[#FFF8ED]">
      <span className="grid size-9 place-items-center rounded-full bg-[#F5C060]/15 text-[#F5C060]">
        {icon}
      </span>
      {text}
    </div>
  );
}
