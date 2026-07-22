import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailCodePurpose = "login" | "signup" | "recovery";
export type AuthAction =
  | "login"
  | "signup"
  | "send"
  | "verify"
  | "password";

export type StoredAuthFlow = {
  view: "verify" | "new-password";
  purpose: EmailCodePurpose;
  email: string;
};

type AuthClient = Pick<
  SupabaseClient["auth"],
  | "resend"
  | "resetPasswordForEmail"
  | "signInWithOtp"
  | "signInWithPassword"
  | "signOut"
  | "signUp"
  | "updateUser"
  | "verifyOtp"
>;

type AuthErrorLike = { code?: string; message?: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthEmail(email: string) {
  return email.trim();
}

export function isValidAuthEmail(email: string) {
  return EMAIL_PATTERN.test(normalizeAuthEmail(email));
}

export function parseStoredAuthFlow(value: string | null): StoredAuthFlow | null {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as Partial<StoredAuthFlow>;
    const validView =
      candidate.view === "verify" || candidate.view === "new-password";
    const validPurpose =
      candidate.purpose === "login" ||
      candidate.purpose === "signup" ||
      candidate.purpose === "recovery";

    if (
      !validView ||
      !validPurpose ||
      typeof candidate.email !== "string" ||
      !isValidAuthEmail(candidate.email) ||
      (candidate.view === "new-password" && candidate.purpose !== "recovery")
    ) {
      return null;
    }

    return {
      view: candidate.view as StoredAuthFlow["view"],
      purpose: candidate.purpose as EmailCodePurpose,
      email: normalizeAuthEmail(candidate.email),
    };
  } catch {
    return null;
  }
}

export function validateNewPassword(password: string, confirmation: string) {
  if (!password) return "missing" as const;
  if (password.length < 8) return "too_short" as const;
  if (password !== confirmation) return "mismatch" as const;
  return null;
}

export function registerWithPassword(
  auth: AuthClient,
  email: string,
  password: string,
) {
  return auth.signUp({
    email: normalizeAuthEmail(email),
    password,
  });
}

export function loginWithPassword(
  auth: AuthClient,
  email: string,
  password: string,
) {
  return auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
  });
}

export function sendEmailLoginCode(auth: AuthClient, email: string) {
  return auth.signInWithOtp({
    email: normalizeAuthEmail(email),
    options: { shouldCreateUser: false },
  });
}

export function verifyEmailCode(
  auth: AuthClient,
  purpose: EmailCodePurpose,
  email: string,
  token: string,
) {
  return auth.verifyOtp({
    email: normalizeAuthEmail(email),
    token,
    type: purpose === "recovery" ? "recovery" : "email",
  });
}

export function sendPasswordRecoveryCode(auth: AuthClient, email: string) {
  return auth.resetPasswordForEmail(normalizeAuthEmail(email));
}

export function saveRecoveredPassword(auth: AuthClient, password: string) {
  return auth.updateUser({ password });
}

export function revokeOtherSessions(auth: AuthClient) {
  return auth.signOut({ scope: "others" });
}

export function resendEmailCode(
  auth: AuthClient,
  purpose: EmailCodePurpose,
  email: string,
) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (purpose === "signup") {
    return auth.resend({ type: "signup", email: normalizedEmail });
  }
  if (purpose === "recovery") {
    return auth.resetPasswordForEmail(normalizedEmail);
  }
  return auth.signInWithOtp({
    email: normalizedEmail,
    options: { shouldCreateUser: false },
  });
}

export function isMissingOrExpiredSession(error: AuthErrorLike) {
  return [
    "session_not_found",
    "session_expired",
    "refresh_token_not_found",
    "refresh_token_already_used",
  ].includes(error.code ?? "");
}

export function authErrorMessage(error: AuthErrorLike, action: AuthAction) {
  const code = error.code ?? "";
  const message = error.message?.toLowerCase() ?? "";

  if (code === "over_email_send_rate_limit" || message.includes("rate limit"))
    return "寄送次數太多，請稍候一分鐘再試。";
  if (code === "over_request_rate_limit") return "操作次數太多，請稍後再試。";
  if (code === "captcha_failed") return "安全驗證未完成，請重新操作一次。";
  if (code === "otp_expired" || action === "verify")
    return "驗證碼不正確或已過期，請重新輸入或寄送新的驗證碼。";
  if (code === "email_not_confirmed")
    return "這個信箱尚未完成驗證，請重新建立帳號並取得新的驗證碼。";
  if (isMissingOrExpiredSession(error) || code === "reauthentication_needed")
    return "驗證已過期，請重新寄送重設驗證碼。";
  if (code === "same_password") return "新密碼不可與目前密碼相同。";
  if (code === "weak_password")
    return "這組密碼無法使用，請設定至少 8 個字元的新密碼。";
  if (action === "password") return "新密碼暫時無法儲存，請重新驗證後再試。";
  if (action === "signup")
    return "帳號目前無法建立；若曾註冊過，請回到登入或使用忘記密碼。";
  if (action === "login") return "電子信箱或密碼不正確，請再試一次。";
  if (action === "send") return "驗證碼暫時無法寄出，請稍後再試。";
  return "系統暫時無法完成操作，請稍後再試。";
}
