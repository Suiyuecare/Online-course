import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE: z.string().min(1).optional(),
  NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY: z.string().min(1).optional(),
});

const serverSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]),
  ALLOW_LOCAL_MOCK_PROVIDERS: z.enum(["true", "false"]).default("false"),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  IDENTITY_RISK_ENDPOINT: z.string().url().optional(),
  IDENTITY_RISK_TOKEN: z.string().min(32).optional(),
  IDENTITY_RECOVERY_ENDPOINT: z.string().url().optional(),
  IDENTITY_RECOVERY_TOKEN: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  RATE_LIMIT_HMAC_SECRET: z.string().min(32).optional(),
  BANK_IMPORT_HMAC_SECRET: z.string().min(32).optional(),
  PII_KMS_PROVIDER: z.string().min(1).optional(),
  PII_KMS_KEY_ID: z.string().min(1).optional(),
  PII_KMS_ENDPOINT: z.string().url().optional(),
  PII_KMS_ACCESS_TOKEN: z.string().min(32).optional(),
  PII_BLIND_INDEX_KEY_CURRENT: z.string().min(32).optional(),
  PII_BLIND_INDEX_KEY_PREVIOUS: z.string().min(32).optional(),
  ORGANIZATION_INVITATION_BLIND_INDEX_KEY: z.string().min(32).optional(),
  LOCAL_KMS_MASTER_KEY: z.string().min(43).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
  VIDEO_MASTER_BACKUP_ENDPOINT: z.string().url().optional(),
  VIDEO_MASTER_BACKUP_TOKEN: z.string().min(32).optional(),
  ZOOM_ACCOUNT_ID: z.string().min(1).optional(),
  ZOOM_MEETING_SDK_ACCOUNT_ID: z.string().min(1).optional(),
  ZOOM_CLIENT_ID: z.string().min(1).optional(),
  ZOOM_CLIENT_SECRET: z.string().min(1).optional(),
  ZOOM_HOST_USER_ID: z.string().min(1).optional(),
  ZOOM_MEETING_SDK_SECRET: z.string().min(1).optional(),
  ZOOM_WEBHOOK_SECRET_TOKEN: z.string().min(1).optional(),
  ZOOM_SECRET_ENCRYPTION_KEY: z.string().min(43).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  EMAIL_VERIFICATION_HMAC_SECRET: z.string().min(32).optional(),
  LOCAL_EMAIL_VERIFICATION_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  CERTIFICATE_RENDERER_ENDPOINT: z.string().url().optional(),
  CERTIFICATE_RENDERER_TOKEN: z.string().min(32).optional(),
  CERTIFICATE_ISSUING_PERSON_ID: z.uuid().optional(),
  MALWARE_SCANNER_ENDPOINT: z.string().url().optional(),
  MALWARE_SCANNER_TOKEN: z.string().min(32).optional(),
  LEGAL_ENTITY_NAME: z.string().min(1).optional(),
  LEGAL_TAX_ID: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  LEGAL_ADDRESS: z.string().min(1).optional(),
  SUPPORT_PHONE: z.string().min(1).optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
  BANK_NAME: z.string().min(1).optional(),
  BANK_CODE: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  BANK_ACCOUNT_NAME: z.string().min(1).optional(),
  BANK_ACCOUNT_NUMBER: z.string().min(1).optional(),
  FINANCE_HIGH_VALUE_REVIEW_THRESHOLD_TWD: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  INCIDENT_OWNER: z.string().min(1).optional(),
  EMERGENCY_DISABLE_ALL: z.enum(["true", "false"]).default("true"),
  EMERGENCY_DISABLE_PAYMENTS: z.enum(["true", "false"]).default("true"),
  EMERGENCY_DISABLE_EXPORTS: z.enum(["true", "false"]).default("true"),
  EMERGENCY_DISABLE_CERTIFICATES: z.enum(["true", "false"]).default("true"),
});

export function publicConfig() {
  return publicSchema.parse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined,
    NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE:
      process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE || undefined,
    NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY:
      process.env.NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY || undefined,
  });
}

export function serverConfig() {
  const appEnv =
    process.env.APP_ENV ??
    (process.env.NODE_ENV === "production" ? "production" : "development");
  return serverSchema.parse({
    ...process.env,
    APP_ENV: appEnv,
    ALLOW_LOCAL_MOCK_PROVIDERS:
      process.env.ALLOW_LOCAL_MOCK_PROVIDERS ?? "false",
    EMERGENCY_DISABLE_ALL: process.env.EMERGENCY_DISABLE_ALL ?? "true",
    EMERGENCY_DISABLE_PAYMENTS:
      process.env.EMERGENCY_DISABLE_PAYMENTS ?? "true",
    EMERGENCY_DISABLE_EXPORTS: process.env.EMERGENCY_DISABLE_EXPORTS ?? "true",
    EMERGENCY_DISABLE_CERTIFICATES:
      process.env.EMERGENCY_DISABLE_CERTIFICATES ?? "true",
  });
}

export function productionReadiness() {
  const config = serverConfig();
  const siteOrigin = new URL(publicConfig().NEXT_PUBLIC_SITE_URL).origin;
  return {
    site:
      config.APP_ENV !== "production" ||
      siteOrigin === "https://class.suiyuecare.com",
    auth: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
        config.SUPABASE_SECRET_KEY &&
        config.TURNSTILE_SECRET_KEY &&
        config.IDENTITY_RISK_ENDPOINT &&
        config.IDENTITY_RISK_TOKEN &&
        config.IDENTITY_RECOVERY_ENDPOINT &&
        config.IDENTITY_RECOVERY_TOKEN,
    ),
    stream: Boolean(
      config.CLOUDFLARE_ACCOUNT_ID &&
        config.CLOUDFLARE_STREAM_API_TOKEN &&
        config.CLOUDFLARE_STREAM_WEBHOOK_SECRET &&
        config.CLOUDFLARE_STREAM_SIGNING_KEY_ID &&
        config.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY &&
        config.VIDEO_MASTER_BACKUP_ENDPOINT &&
        config.VIDEO_MASTER_BACKUP_TOKEN,
    ),
    zoom: Boolean(
      config.ZOOM_ACCOUNT_ID &&
        config.ZOOM_MEETING_SDK_ACCOUNT_ID &&
        config.ZOOM_MEETING_SDK_ACCOUNT_ID === config.ZOOM_ACCOUNT_ID &&
        config.ZOOM_CLIENT_ID &&
        config.ZOOM_CLIENT_SECRET &&
        config.ZOOM_HOST_USER_ID &&
        process.env.NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY &&
        config.ZOOM_MEETING_SDK_SECRET &&
        config.ZOOM_WEBHOOK_SECRET_TOKEN &&
        config.ZOOM_SECRET_ENCRYPTION_KEY,
    ),
    notifications: Boolean(
      config.RESEND_API_KEY &&
        config.RESEND_FROM_EMAIL &&
        config.RESEND_WEBHOOK_SECRET &&
        config.EMAIL_VERIFICATION_HMAC_SECRET &&
        config.TWILIO_ACCOUNT_SID &&
        config.TWILIO_AUTH_TOKEN &&
        config.TWILIO_MESSAGING_SERVICE_SID,
    ),
    kms: Boolean(
      config.PII_KMS_PROVIDER &&
        config.PII_KMS_KEY_ID &&
        config.PII_KMS_ENDPOINT &&
        config.PII_KMS_ACCESS_TOKEN &&
        config.PII_BLIND_INDEX_KEY_CURRENT &&
        config.ORGANIZATION_INVITATION_BLIND_INDEX_KEY,
    ),
    legal: Boolean(
      config.LEGAL_ENTITY_NAME &&
        config.LEGAL_TAX_ID &&
        config.LEGAL_ADDRESS &&
        config.SUPPORT_PHONE &&
        config.SUPPORT_EMAIL,
    ),
    finance: Boolean(
      config.BANK_NAME &&
        config.BANK_CODE &&
        config.BANK_ACCOUNT_NAME &&
        config.BANK_ACCOUNT_NUMBER &&
        config.FINANCE_HIGH_VALUE_REVIEW_THRESHOLD_TWD &&
        config.BANK_IMPORT_HMAC_SECRET,
    ),
    operations: Boolean(
      config.INCIDENT_OWNER &&
        config.RATE_LIMIT_HMAC_SECRET &&
        config.CRON_SECRET,
    ),
    certificates: Boolean(
      config.CERTIFICATE_RENDERER_ENDPOINT &&
        config.CERTIFICATE_RENDERER_TOKEN &&
        config.CERTIFICATE_ISSUING_PERSON_ID,
    ),
    quarantine: Boolean(
      config.MALWARE_SCANNER_ENDPOINT && config.MALWARE_SCANNER_TOKEN,
    ),
  };
}
