import { createSign, randomUUID } from "node:crypto";
import { localProvidersAllowed } from "@/domain/identity";
import { serverConfig } from "@/infrastructure/config";

const CLOUDFLARE_MAX_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PLAYBACK_STARTUP_BUFFER_SECONDS = 15 * 60;
const PLAYBACK_ROTATION_MAX_SECONDS = 30 * 60;
const PREVIEW_STARTUP_BUFFER_SECONDS = 60;
const PREVIEW_TOKEN_MAX_SECONDS = 5 * 60;

export function playbackTokenTtlSeconds(durationSeconds: number): number {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error("STREAM_DURATION_REQUIRED");
  }
  return Math.min(
    CLOUDFLARE_MAX_TOKEN_TTL_SECONDS,
    PLAYBACK_ROTATION_MAX_SECONDS,
    durationSeconds + PLAYBACK_STARTUP_BUFFER_SECONDS,
  );
}

export function previewTokenTtlSeconds(durationSeconds: number): number {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error("STREAM_DURATION_REQUIRED");
  }
  return Math.min(
    PREVIEW_TOKEN_MAX_SECONDS,
    durationSeconds + PREVIEW_STARTUP_BUFFER_SECONDS,
  );
}

export class CloudflareStreamAdapter {
  private config = serverConfig();

  private assertConfigured() {
    if (
      !this.config.CLOUDFLARE_ACCOUNT_ID ||
      !this.config.CLOUDFLARE_STREAM_API_TOKEN
    ) {
      throw new Error("STREAM_PROVIDER_UNAVAILABLE");
    }
  }

  async createDirectUpload(maxDurationSeconds: number, creator: string) {
    this.assertConfigured();
    if (!/^[0-9a-f-]{36}$/i.test(creator)) {
      throw new Error("STREAM_UPLOAD_CREATOR_INVALID");
    }
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        this.config.CLOUDFLARE_ACCOUNT_ID!,
      )}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.CLOUDFLARE_STREAM_API_TOKEN}`,
          "content-type": "application/json",
          "upload-creator": creator,
        },
        body: JSON.stringify({
          maxDurationSeconds,
          creator,
          meta: { suiyueUploadIntentId: creator },
          requireSignedURLs: true,
          expiry: new Date(Date.now() + 15 * 60_000).toISOString(),
        }),
      },
    );
    const payload = (await response.json()) as {
      success?: boolean;
      result?: { uid: string; uploadURL: string };
    };
    if (!response.ok || !payload.success || !payload.result) {
      throw new Error("STREAM_DIRECT_UPLOAD_FAILED");
    }
    return payload.result;
  }

  async deleteAsset(videoUid: string) {
    this.assertConfigured();
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        this.config.CLOUDFLARE_ACCOUNT_ID!,
      )}/stream/${encodeURIComponent(videoUid)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${this.config.CLOUDFLARE_STREAM_API_TOKEN}`,
        },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error("STREAM_COMPENSATION_FAILED");
    }
  }

  createPlaybackToken(videoUid: string, durationSeconds: number): string {
    const keyId = this.config.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
    const privateKey = this.config.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY;
    if (!keyId || !privateKey || !videoUid) {
      throw new Error("STREAM_SIGNING_UNAVAILABLE");
    }
    const expiresInSeconds = playbackTokenTtlSeconds(durationSeconds);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: keyId }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: videoUid,
        kid: keyId,
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        accessRules: [{ type: "any", action: "allow" }],
      }),
    ).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(privateKey.replace(/\\n/g, "\n"), "base64url");
    return `${unsigned}.${signature}`;
  }

  createPreviewToken(videoUid: string, durationSeconds: number): string {
    const keyId = this.config.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
    const privateKey = this.config.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY;
    if (!keyId || !privateKey || !videoUid) {
      throw new Error("STREAM_SIGNING_UNAVAILABLE");
    }
    const expiresInSeconds = previewTokenTtlSeconds(durationSeconds);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: keyId }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: videoUid,
        kid: keyId,
        jti: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        accessRules: [{ type: "any", action: "allow" }],
      }),
    ).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(privateKey.replace(/\\n/g, "\n"), "base64url");
    return `${unsigned}.${signature}`;
  }
}

export class LocalStreamAdapter {
  private assertLocal() {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.APP_ENV !== "development" ||
      process.env.ALLOW_LOCAL_MOCK_PROVIDERS !== "true"
    ) {
      throw new Error("LOCAL_STREAM_DISABLED");
    }
  }

  async createDirectUpload(_maxDurationSeconds?: number, creator?: string) {
    this.assertLocal();
    if (creator && !/^[0-9a-f-]{36}$/i.test(creator)) {
      throw new Error("STREAM_UPLOAD_CREATOR_INVALID");
    }
    const uid = randomUUID();
    return {
      uid,
      uploadURL: `/api/local/stream-upload?uid=${encodeURIComponent(uid)}`,
    };
  }

  async deleteAsset() {
    this.assertLocal();
  }

  createPlaybackToken(_videoUid: string, durationSeconds: number) {
    this.assertLocal();
    playbackTokenTtlSeconds(durationSeconds);
    return "local-stream-token";
  }

  createPreviewToken(_videoUid: string, durationSeconds: number) {
    this.assertLocal();
    previewTokenTtlSeconds(durationSeconds);
    return "local-preview-token";
  }
}

export function streamAdapter() {
  return localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  })
    ? new LocalStreamAdapter()
    : new CloudflareStreamAdapter();
}
