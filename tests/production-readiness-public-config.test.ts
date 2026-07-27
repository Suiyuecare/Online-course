import { afterEach, describe, expect, it, vi } from "vitest";
import { productionReadiness } from "@/infrastructure/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production provider readiness", () => {
  it("requires both browser and server abuse-control configuration", () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-secret");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    vi.stubEnv("IDENTITY_RISK_ENDPOINT", "https://risk.example.test");
    vi.stubEnv("IDENTITY_RISK_TOKEN", "r".repeat(32));
    vi.stubEnv("IDENTITY_RECOVERY_ENDPOINT", "https://recovery.example.test");
    vi.stubEnv("IDENTITY_RECOVERY_TOKEN", "i".repeat(32));

    expect(productionReadiness().auth).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "turnstile-site");
    expect(productionReadiness().auth).toBe(true);
  });

  it("requires the browser customer code before declaring Stream ready", () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account");
    vi.stubEnv("CLOUDFLARE_STREAM_API_TOKEN", "api-token");
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "webhook-secret");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "signing-key");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY", "private-key");
    vi.stubEnv("VIDEO_MASTER_BACKUP_ENDPOINT", "https://backup.example.test");
    vi.stubEnv("VIDEO_MASTER_BACKUP_TOKEN", "b".repeat(32));

    expect(productionReadiness().stream).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE", "customer");
    expect(productionReadiness().stream).toBe(true);
  });
});
