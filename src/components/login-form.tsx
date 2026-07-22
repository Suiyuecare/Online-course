"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  authErrorMessage,
  isMissingOrExpiredSession,
  isValidAuthEmail,
  loginWithPassword,
  parseStoredAuthFlow,
  registerWithPassword,
  resendEmailCode,
  revokeOtherSessions,
  saveRecoveredPassword,
  sendEmailLoginCode,
  sendPasswordRecoveryCode,
  validateNewPassword,
  verifyEmailCode,
  type EmailCodePurpose,
} from "@/lib/auth-flow";
import { safeInternalPath } from "@/lib/safe-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type View =
  | "otp-login"
  | "password-login"
  | "signup"
  | "verify"
  | "recovery"
  | "new-password";
type CodePurpose = EmailCodePurpose;
type Notice = { kind: "error" | "success"; text: string } | null;

const AUTH_FLOW_STORAGE_KEY = "suiyue-auth-flow-v1";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeInternalPath(params.get("next"));
  const callbackError = params.get("error");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>("otp-login");
  const [codePurpose, setCodePurpose] = useState<CodePurpose | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [flowRestored, setFlowRestored] = useState(false);
  const configured = Boolean(getSupabaseBrowserClient());

  useEffect(() => {
    let restoredFlow: ReturnType<typeof parseStoredAuthFlow> = null;
    try {
      restoredFlow = parseStoredAuthFlow(
        window.sessionStorage.getItem(AUTH_FLOW_STORAGE_KEY),
      );
    } catch {
      // Invalid or unavailable storage should not block the login page.
    }

    const timer = window.setTimeout(() => {
      if (restoredFlow) {
        setEmail(restoredFlow.email);
        setCodePurpose(restoredFlow.purpose);
        setView(restoredFlow.view);
        setNotice({
          kind: "success",
          text:
            restoredFlow.view === "new-password"
              ? "信箱驗證已完成，請繼續設定新密碼。"
              : "已回到剛才的驗證步驟，請輸入信件中的六位數字。",
        });
      } else if (callbackError === "auth_callback") {
        setNotice({
          kind: "error",
          text: "登入連結無效或已過期，請改用下方的密碼或六位數驗證碼登入。",
        });
      }
      setFlowRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [callbackError]);

  useEffect(() => {
    if (!flowRestored) return;
    try {
      if (
        (view === "verify" || view === "new-password") &&
        codePurpose &&
        isValidAuthEmail(email)
      ) {
        window.sessionStorage.setItem(
          AUTH_FLOW_STORAGE_KEY,
          JSON.stringify({ view, purpose: codePurpose, email }),
        );
      } else {
        window.sessionStorage.removeItem(AUTH_FLOW_STORAGE_KEY);
      }
    } catch {
      // Safari private mode may disable sessionStorage; the auth flow still works in-memory.
    }
  }, [codePurpose, email, flowRestored, view]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function changeView(nextView: View) {
    if (busy) return;
    clearStoredFlow();
    setView(nextView);
    setOtp("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setCodePurpose(null);
    setNotice(null);
  }

  function updateEmail(value: string) {
    setEmail(value);
    if (notice?.kind === "error") setNotice(null);
  }

  function updatePasswordInput(value: string) {
    setPassword(value);
    if (notice?.kind === "error") setNotice(null);
  }

  function validEmail() {
    if (isValidAuthEmail(email)) return true;
    setNotice({
      kind: "error",
      text: "請輸入完整的電子信箱，例如 name@example.com。",
    });
    emailRef.current?.focus();
    return false;
  }

  function validPassword(requireConfirmation = false) {
    const validation = requireConfirmation
      ? validateNewPassword(password, passwordConfirmation)
      : password
        ? null
        : "missing";
    if (validation === "missing") {
      setNotice({ kind: "error", text: "請輸入密碼。" });
      passwordRef.current?.focus();
      return false;
    }
    if (validation === "too_short") {
      setNotice({ kind: "error", text: "密碼至少需要 8 個字元。" });
      passwordRef.current?.focus();
      return false;
    }
    if (validation === "mismatch") {
      setNotice({ kind: "error", text: "兩次輸入的密碼不相同，請再確認。" });
      confirmationRef.current?.focus();
      return false;
    }
    return true;
  }

  function finishLogin() {
    clearStoredFlow();
    router.replace(next);
    router.refresh();
  }

  async function sendLoginCode(event: FormEvent) {
    event.preventDefault();
    if (!validEmail()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({
        kind: "error",
        text: "登入服務尚未完成設定，目前只能預覽畫面。",
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const { error } = await sendEmailLoginCode(supabase.auth, email);
      if (error) {
        setNotice({ kind: "error", text: authErrorMessage(error, "send") });
        return;
      }
      setCodePurpose("login");
      setView("verify");
      setCooldown(60);
      setNotice({
        kind: "success",
        text: "登入驗證碼已寄出，請查看收件匣或垃圾郵件。",
      });
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function passwordLogin(event: FormEvent) {
    event.preventDefault();
    if (!validEmail() || !validPassword()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({
        kind: "error",
        text: "登入服務尚未完成設定，目前只能預覽畫面。",
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await loginWithPassword(
        supabase.auth,
        email,
        password,
      );
      if (error) {
        if (error.code === "email_not_confirmed") {
          const resendResult = await resendEmailCode(
            supabase.auth,
            "signup",
            email,
          );
          if (!resendResult.error) {
            setCodePurpose("signup");
            setView("verify");
            setCooldown(60);
            setNotice({
              kind: "success",
              text: "這個帳號還差信箱驗證；新的六位數驗證碼已寄出。",
            });
            return;
          }
          setNotice({
            kind: "error",
            text: authErrorMessage(resendResult.error, "send"),
          });
          return;
        }
        setNotice({ kind: "error", text: authErrorMessage(error, "login") });
        return;
      }
      if (!data.session) {
        setNotice({
          kind: "error",
          text: "登入階段沒有建立有效連線，請重新登入一次。",
        });
        return;
      }
      finishLogin();
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event: FormEvent) {
    event.preventDefault();
    if (!validEmail() || !validPassword(true)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({
        kind: "error",
        text: "帳號服務尚未完成設定，目前還不能建立帳號。",
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await registerWithPassword(
        supabase.auth,
        email,
        password,
      );
      if (error) {
        setNotice({ kind: "error", text: authErrorMessage(error, "signup") });
        return;
      }
      if (data.session) {
        await supabase.auth.signOut();
        setNotice({
          kind: "error",
          text: "信箱驗證功能尚未啟用，為了帳號安全目前不能完成註冊，請聯絡歲悅客服。",
        });
        return;
      }
      setCodePurpose("signup");
      setView("verify");
      setCooldown(60);
      setNotice({
        kind: "success",
        text: "如果這是新帳號，驗證碼會寄到信箱；若以前註冊過，請回到登入或使用忘記密碼。",
      });
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function sendRecoveryCode(event: FormEvent) {
    event.preventDefault();
    if (!validEmail()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({
        kind: "error",
        text: "登入服務尚未完成設定，目前還不能重設密碼。",
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const { error } = await sendPasswordRecoveryCode(supabase.auth, email);
      if (error) {
        setNotice({ kind: "error", text: authErrorMessage(error, "send") });
        return;
      }
      setCodePurpose("recovery");
      setView("verify");
      setCooldown(60);
      setNotice({
        kind: "success",
        text: "如果這個 Email 已建立帳號，重設驗證碼已寄到信箱。",
      });
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!codePurpose || otp.length !== 6) {
      setNotice({ kind: "error", text: "請輸入信件中的六位數驗證碼。" });
      otpRef.current?.focus();
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({ kind: "error", text: "登入服務尚未完成設定，無法驗證。" });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await verifyEmailCode(
        supabase.auth,
        codePurpose,
        email,
        otp,
      );
      if (error) {
        setNotice({ kind: "error", text: authErrorMessage(error, "verify") });
        otpRef.current?.focus();
        return;
      }
      if (!data.session) {
        setNotice({
          kind: "error",
          text: "驗證已完成，但登入連線沒有建立，請重新寄送驗證碼。",
        });
        return;
      }
      if (codePurpose === "recovery") {
        setPassword("");
        setPasswordConfirmation("");
        setView("new-password");
        setNotice({
          kind: "success",
          text: "信箱驗證完成，請設定一組新密碼。",
        });
        return;
      }
      finishLogin();
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!validPassword(true)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);
    try {
      const { error } = await saveRecoveredPassword(supabase.auth, password);
      if (error) {
        if (isMissingOrExpiredSession(error)) {
          clearStoredFlow();
          setView("recovery");
          setCodePurpose(null);
          setPassword("");
          setPasswordConfirmation("");
        }
        setNotice({ kind: "error", text: authErrorMessage(error, "password") });
        return;
      }
      // Keep this browser signed in while revoking refresh tokens on other devices.
      try {
        await revokeOtherSessions(supabase.auth);
      } catch {
        // Password recovery succeeded; a best-effort cleanup must not trap the learner here.
      }
      finishLogin();
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (!codePurpose || cooldown > 0 || busy) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);
    try {
      const { error } = await resendEmailCode(
        supabase.auth,
        codePurpose,
        email,
      );
      if (error) {
        setNotice({ kind: "error", text: authErrorMessage(error, "send") });
        return;
      }
      setOtp("");
      setCooldown(60);
      setNotice({
        kind: "success",
        text: "若帳號符合目前步驟，新的驗證碼會寄到信箱。",
      });
      otpRef.current?.focus();
    } catch {
      setNotice({ kind: "error", text: networkErrorMessage() });
    } finally {
      setBusy(false);
    }
  }

  const title = viewTitle(view, codePurpose);

  return (
    <main className="grid min-h-screen lg:grid-cols-[.9fr_1.1fr]">
      <section className="flex items-center justify-center bg-white p-6 sm:p-10">
        <div className="w-full max-w-md" aria-busy={busy}>
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
            className="mt-8 flex min-h-11 w-fit items-center gap-1 text-base font-bold text-slate-500 hover:text-[#B45309]"
          >
            <ArrowLeft className="size-4" />
            回到首頁
          </Link>

          <h1
            aria-live="polite"
            className="mt-6 text-3xl font-black tracking-[-.04em] text-[#302318]"
          >
            {title}
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            {viewDescription(view, email, codePurpose)}
          </p>

          {(view === "otp-login" || view === "password-login") && (
            <div
              role="group"
              className="mt-6 grid grid-cols-2 rounded-2xl bg-[#FFF8ED] p-1.5"
              aria-label="選擇登入方式"
            >
              <MethodButton
                active={view === "otp-login"}
                disabled={busy}
                onClick={() => changeView("otp-login")}
              >
                驗證碼登入
              </MethodButton>
              <MethodButton
                active={view === "password-login"}
                disabled={busy}
                onClick={() => changeView("password-login")}
              >
                密碼登入
              </MethodButton>
            </div>
          )}

          <div className="mt-6">
            {view === "otp-login" && (
              <EmailForm
                email={email}
                emailRef={emailRef}
                busy={busy}
                buttonText="寄送登入驗證碼"
                busyText="正在寄送…"
                onEmailChange={updateEmail}
                onSubmit={sendLoginCode}
              />
            )}

            {view === "password-login" && (
              <form className="space-y-4" onSubmit={passwordLogin} noValidate>
                <EmailField
                  email={email}
                  emailRef={emailRef}
                  disabled={busy}
                  onEmailChange={updateEmail}
                />
                <PasswordField
                  label="密碼"
                  password={password}
                  passwordRef={passwordRef}
                  showPassword={showPassword}
                  disabled={busy}
                  autoComplete="current-password"
                  onPasswordChange={updatePasswordInput}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                <button
                  disabled={busy}
                  className="button-primary button-large w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "正在登入…" : "登入"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="button-ghost w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => changeView("recovery")}
                >
                  忘記密碼？
                </button>
              </form>
            )}

            {view === "signup" && (
              <form className="space-y-4" onSubmit={signUp} noValidate>
                <EmailField
                  email={email}
                  emailRef={emailRef}
                  disabled={busy}
                  onEmailChange={updateEmail}
                />
                <PasswordField
                  label="設定密碼"
                  password={password}
                  passwordRef={passwordRef}
                  showPassword={showPassword}
                  disabled={busy}
                  autoComplete="new-password"
                  help="至少 8 個字元，請不要使用姓名或生日。"
                  onPasswordChange={updatePasswordInput}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                <label className="block">
                  <span className="mb-2 block text-base font-black text-[#57483A]">
                    再輸入一次密碼
                  </span>
                  <span className="relative block">
                    <LockKeyhole className="absolute left-3 top-3.5 size-5 text-slate-400" />
                    <input
                      ref={confirmationRef}
                      required
                      disabled={busy}
                      minLength={8}
                      type={showPassword ? "text" : "password"}
                      value={passwordConfirmation}
                      onChange={(event) => {
                        setPasswordConfirmation(event.target.value);
                        if (notice?.kind === "error") setNotice(null);
                      }}
                      className="field pl-11"
                      autoComplete="new-password"
                    />
                  </span>
                </label>
                <button
                  disabled={busy}
                  className="button-primary button-large w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "正在建立帳號…" : "建立帳號並寄驗證碼"}
                </button>
              </form>
            )}

            {view === "recovery" && (
              <EmailForm
                email={email}
                emailRef={emailRef}
                busy={busy}
                buttonText="寄送重設驗證碼"
                busyText="正在寄送…"
                onEmailChange={updateEmail}
                onSubmit={sendRecoveryCode}
              />
            )}

            {view === "verify" && (
              <form className="space-y-4" onSubmit={verifyCode} noValidate>
                <label className="block">
                  <span className="mb-2 block text-base font-black text-[#57483A]">
                    六位數驗證碼
                  </span>
                  <span className="relative block">
                    <KeyRound className="absolute left-3 top-3.5 size-5 text-slate-400" />
                    <input
                      ref={otpRef}
                      required
                      disabled={busy}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={otp}
                      onChange={(event) => {
                        setOtp(event.target.value.replace(/\D/g, ""));
                        if (notice?.kind === "error") setNotice(null);
                      }}
                      className="field pl-11 text-center text-2xl font-black tracking-[.3em]"
                      placeholder="000000"
                      autoComplete="one-time-code"
                      aria-describedby="otp-help"
                    />
                  </span>
                </label>
                <p id="otp-help" className="text-sm leading-6 text-slate-500">
                  驗證碼 10 分鐘內有效。沒有收到時，請查看垃圾郵件或促銷內容。
                </p>
                <button
                  disabled={busy || otp.length !== 6}
                  className="button-primary button-large w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "正在驗證…" : verifyButtonText(codePurpose)}
                </button>
                <button
                  type="button"
                  disabled={busy || cooldown > 0}
                  className="button-secondary w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={resendCode}
                >
                  {cooldown > 0
                    ? `${cooldown} 秒後可重新寄送`
                    : "重新寄送驗證碼"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="button-ghost w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() =>
                    changeView(
                      codePurpose === "signup"
                        ? "signup"
                        : codePurpose === "recovery"
                          ? "recovery"
                          : "otp-login",
                    )
                  }
                >
                  電子信箱填錯了？更換 Email
                </button>
                {codePurpose === "signup" && (
                  <button
                    type="button"
                    disabled={busy}
                    className="button-ghost w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => changeView("otp-login")}
                  >
                    以前註冊過？回到登入
                  </button>
                )}
              </form>
            )}

            {view === "new-password" && (
              <form className="space-y-4" onSubmit={saveNewPassword} noValidate>
                <PasswordField
                  label="設定新密碼"
                  password={password}
                  passwordRef={passwordRef}
                  showPassword={showPassword}
                  disabled={busy}
                  autoComplete="new-password"
                  help="至少 8 個字元，請不要使用姓名或生日。"
                  onPasswordChange={updatePasswordInput}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                <label className="block">
                  <span className="mb-2 block text-base font-black text-[#57483A]">
                    再輸入一次新密碼
                  </span>
                  <span className="relative block">
                    <LockKeyhole className="absolute left-3 top-3.5 size-5 text-slate-400" />
                    <input
                      ref={confirmationRef}
                      required
                      disabled={busy}
                      minLength={8}
                      type={showPassword ? "text" : "password"}
                      value={passwordConfirmation}
                      onChange={(event) => {
                        setPasswordConfirmation(event.target.value);
                        if (notice?.kind === "error") setNotice(null);
                      }}
                      className="field pl-11"
                      autoComplete="new-password"
                    />
                  </span>
                </label>
                <button
                  disabled={busy}
                  className="button-primary button-large w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "正在儲存…" : "儲存新密碼並登入"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="button-ghost w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => changeView("recovery")}
                >
                  驗證已過期？重新寄送
                </button>
              </form>
            )}
          </div>

          {notice && (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={`mt-5 rounded-xl border p-4 text-base font-bold leading-7 ${
                notice.kind === "error"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-[#F1D5A8] bg-[#FFF8ED] text-[#694115]"
              }`}
            >
              {notice.text}
            </p>
          )}

          {(view === "otp-login" || view === "password-login") && (
            <div className="mt-6 border-t border-[#EADFCF] pt-6 text-center">
              <p className="text-base text-slate-600">第一次使用歲悅學苑？</p>
              <button
                type="button"
                disabled={busy}
                className="button-secondary button-large mt-3 w-full disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => changeView("signup")}
              >
                <UserPlus className="size-5" /> 建立新帳號
              </button>
            </div>
          )}

          {(view === "signup" || view === "recovery") && (
            <button
              type="button"
              disabled={busy}
              className="button-ghost mt-5 w-full text-base disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => changeView("otp-login")}
            >
              已經有帳號？回到登入
            </button>
          )}

          {!configured && (
            <Link href="/dashboard?preview=1" className="button-secondary mt-4 w-full">
              只預覽學員中心（不會建立帳號）
            </Link>
          )}
          <p className="mt-6 text-center text-sm leading-6 text-slate-500">
            驗證碼只會寄到你的信箱，歲悅客服不會向你索取驗證碼或密碼。
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
              text="可選密碼或 Email 六位數驗證碼登入"
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

function EmailForm({
  email,
  emailRef,
  busy,
  buttonText,
  busyText,
  onEmailChange,
  onSubmit,
}: {
  email: string;
  emailRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  buttonText: string;
  busyText: string;
  onEmailChange: (email: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <EmailField
        email={email}
        emailRef={emailRef}
        disabled={busy}
        onEmailChange={onEmailChange}
      />
      <button
        disabled={busy}
        className="button-primary button-large w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? busyText : buttonText}
      </button>
    </form>
  );
}

function EmailField({
  email,
  emailRef,
  disabled,
  onEmailChange,
}: {
  email: string;
  emailRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onEmailChange: (email: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-base font-black text-[#57483A]">
        電子信箱（Email）
      </span>
      <span className="relative block">
        <Mail className="absolute left-3 top-3.5 size-5 text-slate-400" />
        <input
          ref={emailRef}
          required
          disabled={disabled}
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          className="field pl-11"
          placeholder="name@example.com"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
        />
      </span>
    </label>
  );
}

function PasswordField({
  label,
  password,
  passwordRef,
  showPassword,
  disabled,
  autoComplete,
  help,
  onPasswordChange,
  onToggle,
}: {
  label: string;
  password: string;
  passwordRef: React.RefObject<HTMLInputElement | null>;
  showPassword: boolean;
  disabled: boolean;
  autoComplete: "current-password" | "new-password";
  help?: string;
  onPasswordChange: (password: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="block">
      <label
        htmlFor="auth-password"
        className="mb-2 block text-base font-black text-[#57483A]"
      >
        {label}
      </label>
      <span className="relative block">
        <LockKeyhole className="absolute left-3 top-3.5 size-5 text-slate-400" />
        <input
          id="auth-password"
          ref={passwordRef}
          required
          disabled={disabled}
          minLength={autoComplete === "new-password" ? 8 : undefined}
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className="field pl-11 pr-24"
          autoComplete={autoComplete}
        />
        <button
          type="button"
          disabled={disabled}
          className="absolute right-2 top-1/2 inline-flex min-h-11 -translate-y-1/2 items-center gap-1 rounded-lg px-2 text-sm font-black text-[#694115] hover:bg-[#FFF8ED] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onToggle}
          aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {showPassword ? "隱藏" : "顯示"}
        </button>
      </span>
      {help && (
        <span className="mt-2 block text-sm leading-6 text-slate-500">
          {help}
        </span>
      )}
    </div>
  );
}

function MethodButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-12 rounded-xl px-3 text-base font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "bg-white text-[#8A3F06] shadow-sm"
          : "text-slate-600 hover:text-[#8A3F06]"
      }`}
    >
      {children}
    </button>
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

function viewTitle(view: View, purpose: CodePurpose | null) {
  if (view === "otp-login") return "使用驗證碼登入";
  if (view === "password-login") return "使用密碼登入";
  if (view === "signup") return "建立歲悅學苑帳號";
  if (view === "recovery") return "忘記密碼";
  if (view === "new-password") return "設定新密碼";
  if (purpose === "signup") return "驗證電子信箱";
  if (purpose === "recovery") return "驗證本人身分";
  return "輸入登入驗證碼";
}

function viewDescription(
  view: View,
  email: string,
  purpose: CodePurpose | null,
) {
  if (view === "otp-login")
    return "我們會把六位數字寄到你的信箱，不用輸入密碼。";
  if (view === "password-login") return "輸入建立帳號時設定的 Email 與密碼。";
  if (view === "signup") return "設定 Email 與密碼，再驗證一次信箱就完成了。";
  if (view === "recovery") return "輸入帳號 Email，我們會寄送六位數重設驗證碼。";
  if (view === "new-password") return "請輸入兩次新密碼，儲存後就會登入。";
  if (purpose === "signup")
    return `若這是新帳號，六位數驗證碼會寄到 ${email}。`;
  const purposeLabel = purpose === "recovery" ? "重設" : "登入";
  return `${purposeLabel}驗證碼已寄到 ${email}。`;
}

function verifyButtonText(purpose: CodePurpose | null) {
  if (purpose === "signup") return "完成驗證並建立帳號";
  if (purpose === "recovery") return "驗證並設定新密碼";
  return "驗證並登入";
}

function networkErrorMessage() {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "目前沒有網路，請確認連線後再試。"
    : "系統暫時無法連線，請稍後再試。";
}

function clearStoredFlow() {
  try {
    window.sessionStorage.removeItem(AUTH_FLOW_STORAGE_KEY);
  } catch {
    // Storage can be unavailable without blocking authentication.
  }
}
