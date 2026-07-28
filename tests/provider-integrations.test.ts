import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playbackTokenRefreshDelayMs,
  PLAYBACK_TOKEN_REFRESH_LEAD_SECONDS,
} from "@/domain/playback";
import {
  clearTerminalLiveJoinAttempt,
  persistedLiveJoinAttemptId,
  type BrowserStorage,
} from "@/domain/live-join-attempt";
import { IdentityRecoveryAdapter } from "@/infrastructure/adapters/identity-recovery";
import { notificationAdapter } from "@/infrastructure/adapters/notifications";
import {
  messagingAdapter,
  TwilioMessagingAdapter,
} from "@/infrastructure/adapters/sms";
import { productionReadiness } from "@/infrastructure/config";
import {
  CloudflareStreamAdapter,
  playbackTokenTtlSeconds,
} from "@/infrastructure/adapters/stream";
import { ZoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import {
  canonicalFingerprint,
  canonicalJson,
} from "@/infrastructure/security/signatures";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("canonical provider payload fingerprints", () => {
  it("sorts recursively while preserving array order", () => {
    const first = {
      outer: { z: 1, a: { second: true, first: false } },
      rows: [{ y: 2, x: 1 }, "tail"],
    };
    const reorderedKeys = {
      rows: [{ x: 1, y: 2 }, "tail"],
      outer: { a: { first: false, second: true }, z: 1 },
    };
    expect(canonicalJson(first)).toBe(canonicalJson(reorderedKeys));
    expect(canonicalFingerprint(first)).toBe(
      canonicalFingerprint(reorderedKeys),
    );
    expect(canonicalFingerprint(first)).not.toBe(
      canonicalFingerprint({
        ...reorderedKeys,
        outer: { ...reorderedKeys.outer, z: 2 },
      }),
    );
    expect(canonicalFingerprint(first)).not.toBe(
      canonicalFingerprint({
        ...reorderedKeys,
        rows: ["tail", { x: 1, y: 2 }],
      }),
    );
  });

  it("rejects values JSON cannot safely fingerprint", () => {
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow(
      "CANONICAL_JSON_NON_FINITE_NUMBER",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("CANONICAL_JSON_CYCLE");
  });
});

describe("Cloudflare signed playback lifetime and refresh", () => {
  it("covers a short video and rotates long-video tokens every 30 minutes", () => {
    expect(playbackTokenTtlSeconds(6 * 60)).toBe(21 * 60);
    expect(playbackTokenTtlSeconds(2 * 60 * 60)).toBe(30 * 60);
    expect(playbackTokenTtlSeconds(30 * 60 * 60)).toBe(30 * 60);
  });

  it("refreshes five minutes before expiry and immediately after a long pause", () => {
    const now = Date.parse("2026-07-24T00:00:00.000Z");
    const expiresAt = new Date(now + 21 * 60_000).toISOString();
    expect(playbackTokenRefreshDelayMs(expiresAt, now)).toBe(
      (21 * 60 - PLAYBACK_TOKEN_REFRESH_LEAD_SECONDS) * 1000,
    );
    expect(playbackTokenRefreshDelayMs(expiresAt, now + 30 * 60_000)).toBe(0);
  });

  it("issues a signed token with the duration-bounded expiry", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "key-one");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY", privateKey);
    const before = Math.floor(Date.now() / 1000);
    const token = new CloudflareStreamAdapter().createPlaybackToken(
      "video-one",
      360,
    );
    const after = Math.floor(Date.now() / 1000);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as { sub: string; exp: number };
    expect(payload.sub).toBe("video-one");
    expect(payload.exp).toBeGreaterThanOrEqual(before + 1260);
    expect(payload.exp).toBeLessThanOrEqual(after + 1260);
  });

  it("rechecks the active lease and full authorization on refresh", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260724180000_provider_operation_sagas.sql",
      ),
      "utf8",
    );
    const refreshBlock = migration.slice(
      migration.indexOf("internal.refresh_recorded_playback"),
      migration.indexOf(
        "create or replace function public.refresh_recorded_playback",
      ),
    );
    expect(refreshBlock).toContain(
      "session.lease_epoch = reported_lease_epoch",
    );
    expect(refreshBlock).toContain("session.active");
    expect(refreshBlock).toContain(
      "internal.authorize_recorded_playback(\n    target_enrollment, lesson_video_version",
    );
    expect(refreshBlock).toContain("session.enrollment_id = target_enrollment");
  });
});

describe("Zoom provider contract", () => {
  function configureZoom() {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("ZOOM_ACCOUNT_ID", "account");
    vi.stubEnv("ZOOM_MEETING_SDK_ACCOUNT_ID", "account");
    vi.stubEnv("ZOOM_CLIENT_ID", "client");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "secret");
    vi.stubEnv("ZOOM_HOST_USER_ID", "host@example.test");
  }

  it("creates an auto-approved meeting that does not require Zoom login", async () => {
    configureZoom();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            uuid: "meeting",
            password: "pass",
            host_id: "host",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await new ZoomMeetingAdapter().createMeeting({
      topic: "照顧課程",
      startsAt: "2026-08-01T01:00:00.000Z",
      durationMinutes: 60,
    });
    const request = fetchMock.mock.calls[1]![1]!;
    const body = JSON.parse(String(request.body)) as {
      settings: Record<string, unknown>;
    };
    expect(body.settings).toMatchObject({
      approval_type: 0,
      registration_type: 1,
      meeting_authentication: false,
      registrants_email_notification: false,
    });
  });

  it("resolves an email host reference to Zoom's canonical host id", async () => {
    configureZoom();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "opaque-zoom-host-id",
            account_id: "account",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new ZoomMeetingAdapter().resolveHostIdentity("host@example.test"),
    ).resolves.toBe("opaque-zoom-host-id");
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      "/users/host%40example.test",
    );
  });

  it("rejects a host owned by a different Zoom account", async () => {
    configureZoom();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "opaque-zoom-host-id",
            account_id: "different-account",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new ZoomMeetingAdapter().resolveHostIdentity("host@example.test"),
    ).rejects.toThrow("ZOOM_HOST_ACCOUNT_MISMATCH");
  });

  it("rejects an initial meeting whose readback differs from the scheduled spec", async () => {
    configureZoom();
    const hostSettings = {
      in_meeting: {
        allow_participants_to_rename: false,
        who_can_share_screen: "host",
        allow_removed_participants_to_rejoin: false,
      },
      recording: { cloud_recording: false },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "opaque-zoom-host-id",
            account_id: "account",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123456789,
            uuid: "meeting-uuid",
            host_id: "opaque-zoom-host-id",
            type: 2,
            topic: "遭竄改的課程",
            start_time: "2026-08-01T01:00:00.000Z",
            duration: 60,
            settings: {
              waiting_room: true,
              join_before_host: false,
              auto_recording: "none",
              meeting_authentication: false,
              approval_type: 0,
              registration_type: 1,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(hostSettings), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ZoomMeetingAdapter();
    const hostId = await adapter.resolveHostIdentity("host@example.test");
    await expect(
      adapter.verifyMeetingSafety(
        {
          id: 123456789,
          uuid: "meeting-uuid",
          host_id: hostId,
        },
        {
          hostId,
          topic: "照顧課程",
          startsAt: "2026-08-01T01:00:00.000Z",
          durationMinutes: 60,
        },
      ),
    ).rejects.toThrow("ZOOM_MEETING_SPEC_MISMATCH");
  });

  it("marks Zoom ready only when Meeting SDK and OAuth share an account", () => {
    configureZoom();
    vi.stubEnv("NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY", "sdk-key");
    vi.stubEnv("ZOOM_MEETING_SDK_SECRET", "sdk-secret");
    vi.stubEnv("ZOOM_WEBHOOK_SECRET_TOKEN", "webhook-secret");
    vi.stubEnv("ZOOM_SECRET_ENCRYPTION_KEY", "a".repeat(43));
    expect(productionReadiness().zoom).toBe(true);

    vi.stubEnv("ZOOM_MEETING_SDK_ACCOUNT_ID", "other-account");
    expect(productionReadiness().zoom).toBe(false);
  });

  it("reconciles only the snapshotted canonical host and accountless meeting", async () => {
    configureZoom();
    const meeting = {
      id: 123456789,
      uuid: "meeting-uuid",
      password: "private-passcode",
      host_id: "opaque-zoom-host-id",
      type: 2,
      topic: "照顧課程",
      start_time: "2026-08-01T01:00:00.000Z",
      duration: 60,
      settings: {
        waiting_room: true,
        join_before_host: false,
        auto_recording: "none",
        meeting_authentication: false,
        approval_type: 0,
        registration_type: 1,
      },
    };
    const hostSettings = {
      in_meeting: {
        allow_participants_to_rename: false,
        who_can_share_screen: "host",
        allow_removed_participants_to_rejoin: false,
      },
      recording: { cloud_recording: false },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(meeting), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(hostSettings), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new ZoomMeetingAdapter().readMeetingForReconciliation({
        meetingNumber: "123456789",
        expectedHostId: "opaque-zoom-host-id",
        expectedTopic: "照顧課程",
        expectedStartsAt: "2026-08-01T01:00:00.000Z",
        expectedDurationMinutes: 60,
      }),
    ).resolves.toMatchObject({
      id: 123456789,
      host_id: "opaque-zoom-host-id",
      safety: { accountlessJoinEnabled: true },
    });
  });

  it("requires Zoom's registrant token and legal customer-key format", async () => {
    configureZoom();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            registrant_id: "registrant",
            join_url:
              "https://zoom.example.test/w/123456789?tk=join-tk&pwd=not-returned",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ZoomMeetingAdapter();
    await expect(
      adapter.registerParticipant({
        meetingNumber: "123456789",
        email: "opaque@zoom-id.suiyuecare.com",
        displayName: "王學員",
        customerKey: "abc_DEF-123",
      }),
    ).resolves.toEqual({
      registrantId: "registrant",
      registrantToken: "join-tk",
    });
    await expect(
      adapter.registerParticipant({
        meetingNumber: "123456789",
        email: "opaque@zoom-id.suiyuecare.com",
        displayName: "王學員",
        customerKey: "bad+/=",
      }),
    ).rejects.toThrow("ZOOM_CUSTOMER_KEY_INVALID");
  });

  it("fails closed when Zoom omits tk from the registrant join URL", async () => {
    configureZoom();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            registrant_id: "registrant",
            join_url: "https://zoom.example.test/w/123456789",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new ZoomMeetingAdapter().registerParticipant({
        meetingNumber: "123456789",
        email: "opaque@zoom-id.suiyuecare.com",
        displayName: "王學員",
        customerKey: "abc_DEF-123",
      }),
    ).rejects.toThrow("ZOOM_REGISTRANT_TOKEN_MISSING");
  });

  it("uses the authoritative leave timestamp for participant-left events", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/webhooks/zoom/route.ts"),
      "utf8",
    );
    expect(route).toContain('payload.event === "meeting.participant_left"');
    expect(route).toContain("? participant?.leave_time");
  });
});

describe("Zoom browser reconnect lease", () => {
  function memoryStorage(): BrowserStorage {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
  }

  it("reuses the same join idempotency key across reloads", () => {
    const storage = memoryStorage();
    const first = persistedLiveJoinAttemptId(
      storage,
      "join-attempt",
      () => "11111111-1111-4111-8111-111111111111",
    );
    const afterReload = persistedLiveJoinAttemptId(
      storage,
      "join-attempt",
      () => "22222222-2222-4222-8222-222222222222",
    );
    expect(afterReload).toBe(first);
  });

  it.each(["abort_accepted", "check_out_accepted", "lease_expired"] as const)(
    "clears credentials only on terminal event %s",
    (event) => {
      const storage = memoryStorage();
      storage.setItem("join-attempt", "11111111-1111-4111-8111-111111111111");
      storage.setItem("device", "a".repeat(64));
      clearTerminalLiveJoinAttempt(storage, ["join-attempt", "device"], event);
      expect(storage.getItem("join-attempt")).toBeNull();
      expect(storage.getItem("device")).toBeNull();
    },
  );
});

describe("business-idempotent recovery providers", () => {
  it("keeps local notification and SMS testing off external networks", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_MOCK_PROVIDERS", "true");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      notificationAdapter().deliver({
        to: "learner@example.test",
        subject: "本機通知",
        html: "<p>本機通知</p>",
        idempotencyKey: "local-email:one",
      }),
    ).resolves.toEqual({
      id: expect.stringMatching(/^local-email-[a-f0-9]{24}$/),
    });
    await expect(
      messagingAdapter().send({
        to: "+886912345678",
        body: "本機簡訊",
        idempotencyKey: "local-sms:one",
      }),
    ).resolves.toEqual({
      providerMessageId: expect.stringMatching(/^local-sms-[a-f0-9]{24}$/),
      status: "delivered",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the business idempotency key to SMS delivery", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG123");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new TwilioMessagingAdapter().send({
      to: "+886912345678",
      body: "通知",
      idempotencyKey: "notification:one",
    });
    expect(
      new Headers(fetchMock.mock.calls[0]![1]?.headers).get("idempotency-key"),
    ).toBe("notification:one");
  });

  it("passes the same key to identity recovery completion", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("IDENTITY_RECOVERY_ENDPOINT", "https://identity.example.test");
    vi.stubEnv(
      "IDENTITY_RECOVERY_TOKEN",
      "identity-provider-token-at-least-32-bytes",
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          replacementAuthUserId: "11111111-1111-4111-8111-111111111111",
          confirmationHash: "a".repeat(64),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new IdentityRecoveryAdapter().complete({
      recoveryCaseId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "identity-recovery:case-one",
    });
    expect(
      new Headers(fetchMock.mock.calls[0]![1]?.headers).get("idempotency-key"),
    ).toBe("identity-recovery:case-one");
  });
});
