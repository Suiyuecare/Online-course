import { describe, expect, it, vi } from "vitest";
import {
  authErrorMessage,
  isMissingOrExpiredSession,
  loginWithPassword,
  parseStoredAuthFlow,
  registerWithPassword,
  revokeOtherSessions,
  resendEmailCode,
  saveRecoveredPassword,
  sendEmailLoginCode,
  sendPasswordRecoveryCode,
  validateNewPassword,
  verifyEmailCode,
} from "./auth-flow";

function authMock() {
  return {
    signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
}

describe("email auth flow", () => {
  it("registers with a trimmed email and a password", async () => {
    const auth = authMock();

    await registerWithPassword(auth as never, " aunt@example.com ", "password123");

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "aunt@example.com",
      password: "password123",
    });
  });

  it("logs in with the existing password without changing credentials", async () => {
    const auth = authMock();

    await loginWithPassword(auth as never, " aunt@example.com ", "password123");

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "aunt@example.com",
      password: "password123",
    });
  });

  it("never creates an account while requesting a login OTP", async () => {
    const auth = authMock();

    await sendEmailLoginCode(auth as never, "aunt@example.com");

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "aunt@example.com",
      options: { shouldCreateUser: false },
    });
  });

  it("uses current email and recovery verification types", async () => {
    const auth = authMock();

    await verifyEmailCode(auth as never, "signup", "aunt@example.com", "123456");
    await verifyEmailCode(auth as never, "login", "aunt@example.com", "234567");
    await verifyEmailCode(auth as never, "recovery", "aunt@example.com", "345678");

    expect(auth.verifyOtp).toHaveBeenNthCalledWith(1, {
      email: "aunt@example.com",
      token: "123456",
      type: "email",
    });
    expect(auth.verifyOtp).toHaveBeenNthCalledWith(2, {
      email: "aunt@example.com",
      token: "234567",
      type: "email",
    });
    expect(auth.verifyOtp).toHaveBeenNthCalledWith(3, {
      email: "aunt@example.com",
      token: "345678",
      type: "recovery",
    });
  });

  it("uses the correct Supabase API for each resend purpose", async () => {
    const auth = authMock();

    await resendEmailCode(auth as never, "signup", "aunt@example.com");
    await resendEmailCode(auth as never, "login", "aunt@example.com");
    await resendEmailCode(auth as never, "recovery", "aunt@example.com");

    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "aunt@example.com",
    });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "aunt@example.com",
      options: { shouldCreateUser: false },
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("aunt@example.com");
  });

  it("uses the recovery endpoint before updating the password", async () => {
    const auth = authMock();

    await sendPasswordRecoveryCode(auth as never, " aunt@example.com ");
    await saveRecoveredPassword(auth as never, "new-password-123");

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("aunt@example.com");
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "new-password-123",
    });
  });

  it("keeps the recovered browser signed in while revoking other sessions", async () => {
    const auth = authMock();

    await revokeOtherSessions(auth as never);

    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });
});

describe("auth flow state and safe errors", () => {
  it("restores only valid verification states", () => {
    expect(
      parseStoredAuthFlow(
        JSON.stringify({
          view: "verify",
          purpose: "signup",
          email: " aunt@example.com ",
        }),
      ),
    ).toEqual({
      view: "verify",
      purpose: "signup",
      email: "aunt@example.com",
    });
    expect(
      parseStoredAuthFlow(
        JSON.stringify({
          view: "new-password",
          purpose: "login",
          email: "aunt@example.com",
        }),
      ),
    ).toBeNull();
    expect(parseStoredAuthFlow("not-json")).toBeNull();
  });

  it("validates new passwords before sending them to Supabase", () => {
    expect(validateNewPassword("", "")).toBe("missing");
    expect(validateNewPassword("short", "short")).toBe("too_short");
    expect(validateNewPassword("password123", "password456")).toBe(
      "mismatch",
    );
    expect(validateNewPassword("password123", "password123")).toBeNull();
  });

  it("distinguishes an expired recovery session from a weak password", () => {
    const expired = { code: "session_expired" };

    expect(isMissingOrExpiredSession(expired)).toBe(true);
    expect(authErrorMessage(expired, "password")).toContain("驗證已過期");
    expect(authErrorMessage({ code: "weak_password" }, "password")).toContain(
      "至少 8 個字元",
    );
  });

  it("does not expose whether an account exists", () => {
    expect(authErrorMessage({ code: "user_not_found" }, "send")).toBe(
      "驗證碼暫時無法寄出，請稍後再試。",
    );
    expect(authErrorMessage({ code: "invalid_credentials" }, "login")).toBe(
      "電子信箱或密碼不正確，請再試一次。",
    );
  });
});
