import { createHmac, randomBytes } from "node:crypto";
import { localProvidersAllowed } from "@/domain/identity";
import {
  attestExistingZoomMeetingSafety,
  attestZoomMeetingSafety,
  type ZoomHostSafetyEvidence,
  type ZoomMeetingSafetyEvidence,
} from "@/domain/zoom-safety";
import { serverConfig } from "@/infrastructure/config";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export class ZoomMeetingAdapter {
  private config = serverConfig();
  private accessToken: { value: string; expiresAt: number } | null = null;

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    if (
      !this.config.ZOOM_ACCOUNT_ID ||
      !this.config.ZOOM_MEETING_SDK_ACCOUNT_ID ||
      this.config.ZOOM_MEETING_SDK_ACCOUNT_ID !== this.config.ZOOM_ACCOUNT_ID ||
      !this.config.ZOOM_CLIENT_ID ||
      !this.config.ZOOM_CLIENT_SECRET
    ) {
      throw new Error("ZOOM_OAUTH_UNAVAILABLE");
    }
    const credentials = Buffer.from(
      `${this.config.ZOOM_CLIENT_ID}:${this.config.ZOOM_CLIENT_SECRET}`,
    ).toString("base64");
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
        this.config.ZOOM_ACCOUNT_ID,
      )}`,
      {
        method: "POST",
        headers: { authorization: `Basic ${credentials}` },
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error("ZOOM_OAUTH_FAILED");
    }
    this.accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  }

  private async api<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`https://api.zoom.us/v2${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "content-type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
    if (response.ok && response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as T | null;
    if (!response.ok || payload === null) throw new Error("ZOOM_API_FAILED");
    return payload;
  }

  private createMeetingSignature(
    meetingNumber: string,
    role: 0 | 1,
    expiresInSeconds = 1800,
  ) {
    const sdkKey = process.env.NEXT_PUBLIC_ZOOM_MEETING_SDK_KEY;
    const secret = this.config.ZOOM_MEETING_SDK_SECRET;
    if (!sdkKey || !secret) throw new Error("ZOOM_JOIN_UNAVAILABLE");
    const issuedAt = Math.floor(Date.now() / 1000) - 30;
    const expiresAt =
      issuedAt + Math.max(1800, Math.min(7200, expiresInSeconds));
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sdkKey,
      appKey: sdkKey,
      mn: meetingNumber,
      role,
      iat: issuedAt,
      exp: expiresAt,
      tokenExp: expiresAt,
    })}`;
    const signature = createHmac("sha256", secret)
      .update(unsigned)
      .digest("base64url");
    return { sdkKey, signature: `${unsigned}.${signature}`, expiresAt };
  }

  createParticipantSignature(meetingNumber: string, expiresInSeconds = 1800) {
    return this.createMeetingSignature(meetingNumber, 0, expiresInSeconds);
  }

  createHostSignature(meetingNumber: string, expiresInSeconds = 1800) {
    return this.createMeetingSignature(meetingNumber, 1, expiresInSeconds);
  }

  async getHostZak(hostUserId: string) {
    const result = await this.api<{ token?: string }>(
      `/users/${encodeURIComponent(hostUserId)}/token?type=zak`,
      { method: "GET" },
    );
    if (!result.token) throw new Error("ZOOM_ZAK_UNAVAILABLE");
    return result.token;
  }

  syntheticRegistrantEmail(domain = "zoom-id.suiyuecare.com") {
    return `${randomBytes(16).toString("hex")}@${domain}`;
  }

  async createMeeting(input: {
    topic: string;
    startsAt: string;
    durationMinutes: number;
    timezone?: string;
    hostUserId?: string;
  }) {
    const hostUserId = input.hostUserId ?? this.config.ZOOM_HOST_USER_ID;
    if (!hostUserId) {
      throw new Error("ZOOM_HOST_UNAVAILABLE");
    }
    return this.api<{
      id: number;
      uuid: string;
      password: string;
      host_id: string;
      settings?: ZoomMeetingSafetyEvidence["settings"];
    }>(`/users/${encodeURIComponent(hostUserId)}/meetings`, {
      method: "POST",
      body: JSON.stringify({
        topic: input.topic,
        type: 2,
        start_time: input.startsAt,
        duration: input.durationMinutes,
        timezone: input.timezone ?? "Asia/Taipei",
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: false,
          mute_upon_entry: true,
          waiting_room: true,
          auto_recording: "none",
          allow_participants_to_rename: false,
          registrants_confirmation_email: false,
          registrants_email_notification: false,
          approval_type: 0,
          registration_type: 1,
          meeting_authentication: false,
        },
      }),
    });
  }

  async resolveHostIdentity(hostUserReference: string) {
    const host = await this.api<{ id?: string; account_id?: string }>(
      `/users/${encodeURIComponent(hostUserReference)}`,
      { method: "GET" },
    );
    if (!host.id) throw new Error("ZOOM_HOST_IDENTITY_UNAVAILABLE");
    if (
      !this.config.ZOOM_ACCOUNT_ID ||
      host.account_id !== this.config.ZOOM_ACCOUNT_ID
    ) {
      throw new Error("ZOOM_HOST_ACCOUNT_MISMATCH");
    }
    return host.id;
  }

  async verifyMeetingSafety(
    created: {
      id: number;
      uuid: string;
      host_id: string;
      settings?: ZoomMeetingSafetyEvidence["settings"];
    },
    expected: {
      hostId: string;
      topic: string;
      startsAt: string;
      durationMinutes: number;
    },
  ) {
    const [readback, hostSettings] = await Promise.all([
      this.api<{
        id: number;
        uuid: string;
        host_id: string;
        type?: number;
        topic?: string;
        start_time?: string;
        duration?: number;
        settings?: ZoomMeetingSafetyEvidence["settings"];
      }>(`/meetings/${encodeURIComponent(String(created.id))}`, {
        method: "GET",
      }),
      this.api<ZoomHostSafetyEvidence>(
        `/users/${encodeURIComponent(created.host_id)}/settings`,
        { method: "GET" },
      ),
    ]);
    if (
      created.host_id !== expected.hostId ||
      readback.host_id !== expected.hostId
    ) {
      throw new Error("ZOOM_HOST_CONFIGURATION_UNSAFE");
    }
    return attestZoomMeetingSafety({
      created: {
        id: created.id,
        uuid: created.uuid,
        hostId: created.host_id,
        settings: created.settings,
      },
      readback: {
        id: readback.id,
        uuid: readback.uuid,
        hostId: readback.host_id,
        type: readback.type,
        topic: readback.topic,
        startTime: readback.start_time,
        durationMinutes: readback.duration,
        settings: readback.settings,
      },
      hostSettings,
      expected: {
        meetingType: 2,
        hostId: expected.hostId,
        topic: expected.topic,
        startsAt: expected.startsAt,
        durationMinutes: expected.durationMinutes,
      },
    });
  }

  async readMeetingForReconciliation(input: {
    meetingNumber: string;
    expectedHostId: string;
    expectedTopic: string;
    expectedStartsAt: string;
    expectedDurationMinutes: number;
  }) {
    const meeting = await this.api<{
      id: number;
      uuid: string;
      password?: string;
      host_id: string;
      type?: number;
      topic?: string;
      start_time?: string;
      duration?: number;
      settings?: ZoomMeetingSafetyEvidence["settings"];
    }>(`/meetings/${encodeURIComponent(input.meetingNumber)}`, {
      method: "GET",
    });
    const hostSettings = await this.api<ZoomHostSafetyEvidence>(
      `/users/${encodeURIComponent(meeting.host_id)}/settings`,
      { method: "GET" },
    );
    const safety = attestExistingZoomMeetingSafety({
      meeting: {
        id: meeting.id,
        uuid: meeting.uuid,
        password: meeting.password,
        hostId: meeting.host_id,
        type: meeting.type,
        topic: meeting.topic,
        startTime: meeting.start_time,
        durationMinutes: meeting.duration,
        settings: meeting.settings,
      },
      hostSettings,
      expected: {
        meetingNumber: input.meetingNumber,
        hostId: input.expectedHostId,
        topic: input.expectedTopic,
        startsAt: input.expectedStartsAt,
        durationMinutes: input.expectedDurationMinutes,
      },
    });
    if (!meeting.password) {
      throw new Error("ZOOM_RECONCILIATION_PASSCODE_MISSING");
    }
    return {
      id: meeting.id,
      uuid: meeting.uuid,
      password: meeting.password,
      host_id: meeting.host_id,
      meetingType: 2 as const,
      topic: meeting.topic!,
      startsAt: meeting.start_time!,
      durationMinutes: meeting.duration!,
      safety,
    };
  }

  async deleteMeeting(meetingNumber: string) {
    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingNumber)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${await this.token()}` },
        cache: "no-store",
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error("ZOOM_API_FAILED");
    }
  }

  async updateMeeting(
    meetingNumber: string,
    input: {
      topic: string;
      startsAt: string;
      durationMinutes: number;
      timezone?: string;
    },
  ) {
    await this.api(`/meetings/${encodeURIComponent(meetingNumber)}`, {
      method: "PATCH",
      body: JSON.stringify({
        topic: input.topic,
        start_time: input.startsAt,
        duration: input.durationMinutes,
        timezone: input.timezone ?? "Asia/Taipei",
      }),
    });
  }

  async registerParticipant(input: {
    meetingNumber: string;
    email: string;
    displayName: string;
    customerKey: string;
  }) {
    if (!/^[A-Za-z0-9_-]{1,36}$/.test(input.customerKey)) {
      throw new Error("ZOOM_CUSTOMER_KEY_INVALID");
    }
    const result = await this.api<{
      registrant_id?: string;
      id?: number;
      join_url?: string;
    }>(`/meetings/${encodeURIComponent(input.meetingNumber)}/registrants`, {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        first_name: input.displayName.slice(0, 64),
        last_name: "歲悅學苑",
      }),
    });
    let registrantToken: string | null = null;
    try {
      registrantToken = result.join_url
        ? new URL(result.join_url).searchParams.get("tk")
        : null;
    } catch {
      registrantToken = null;
    }
    if (
      !result.registrant_id ||
      !registrantToken ||
      registrantToken.length > 4096
    ) {
      throw new Error("ZOOM_REGISTRANT_TOKEN_MISSING");
    }
    return {
      registrantId: result.registrant_id,
      registrantToken,
    };
  }

  async revokeRegistrant(meetingNumber: string, registrantId: string) {
    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(
        meetingNumber,
      )}/registrants/${encodeURIComponent(registrantId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${await this.token()}` },
        cache: "no-store",
      },
    );
    // A replay after an earlier successful deletion, or a meeting that was
    // already removed, has the same security result: the token cannot rejoin.
    if (!response.ok && response.status !== 404) {
      throw new Error("ZOOM_REGISTRANT_REVOKE_FAILED");
    }
  }

  assertSafeJoinPayload(value: {
    passcode: string;
    zak?: string;
    url?: string;
  }) {
    if (
      value.url?.includes(value.passcode) ||
      (value.zak ? value.url?.includes(value.zak) : false)
    ) {
      throw new Error("ZOOM_EPHEMERAL_SECRET_LEAK");
    }
  }
}

export class LocalZoomMeetingAdapter {
  private assertLocal() {
    if (
      !localProvidersAllowed({
        nodeEnv: process.env.NODE_ENV,
        appEnv: process.env.APP_ENV,
        allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
      })
    ) {
      throw new Error("LOCAL_ZOOM_DISABLED");
    }
  }

  createParticipantSignature(meetingNumber: string) {
    this.assertLocal();
    return {
      sdkKey: "local-sdk",
      signature: `local-participant-${meetingNumber}`,
      expiresAt: Math.floor(Date.now() / 1000) + 1800,
    };
  }

  createHostSignature(meetingNumber: string) {
    this.assertLocal();
    return {
      sdkKey: "local-sdk",
      signature: `local-host-${meetingNumber}`,
      expiresAt: Math.floor(Date.now() / 1000) + 1800,
    };
  }

  async getHostZak() {
    this.assertLocal();
    return `local-zak-${randomBytes(8).toString("hex")}`;
  }

  async createMeeting(
    input: {
      topic?: string;
      startsAt?: string;
      durationMinutes?: number;
      hostUserId?: string;
    } = {},
  ) {
    this.assertLocal();
    const suffix = randomBytes(6).toString("hex");
    return {
      id: Number.parseInt(randomBytes(6).toString("hex"), 16),
      uuid: `local-${suffix}`,
      password: randomBytes(6).toString("base64url"),
      host_id: input.hostUserId ?? `local-host-${suffix}`,
      type: 2,
      topic: input.topic ?? "local-meeting",
      start_time: input.startsAt ?? new Date(Date.now() + 60_000).toISOString(),
      duration: input.durationMinutes ?? 60,
      settings: {
        waiting_room: true,
        join_before_host: false,
        auto_recording: "none",
        meeting_authentication: false,
        approval_type: 0,
        registration_type: 1,
      },
    };
  }

  async resolveHostIdentity(hostUserReference: string) {
    this.assertLocal();
    return hostUserReference;
  }

  async verifyMeetingSafety(
    created: {
      id: number;
      uuid: string;
      host_id: string;
      type?: number;
      topic?: string;
      start_time?: string;
      duration?: number;
      settings?: ZoomMeetingSafetyEvidence["settings"];
    },
    expected: {
      hostId: string;
      topic: string;
      startsAt: string;
      durationMinutes: number;
    },
  ) {
    this.assertLocal();
    if (created.host_id !== expected.hostId) {
      throw new Error("ZOOM_HOST_CONFIGURATION_UNSAFE");
    }
    return attestZoomMeetingSafety({
      created: {
        id: created.id,
        uuid: created.uuid,
        hostId: created.host_id,
        settings: created.settings,
      },
      readback: {
        id: created.id,
        uuid: created.uuid,
        hostId: created.host_id,
        type: created.type,
        topic: created.topic,
        startTime: created.start_time,
        durationMinutes: created.duration,
        settings: created.settings,
      },
      hostSettings: {
        in_meeting: {
          allow_participants_to_rename: false,
          who_can_share_screen: "host",
          allow_removed_participants_to_rejoin: false,
        },
        recording: { cloud_recording: false },
      },
      expected: {
        meetingType: 2,
        hostId: expected.hostId,
        topic: expected.topic,
        startsAt: expected.startsAt,
        durationMinutes: expected.durationMinutes,
      },
    });
  }

  async readMeetingForReconciliation(input: {
    meetingNumber: string;
    expectedHostId: string;
    expectedTopic: string;
    expectedStartsAt: string;
    expectedDurationMinutes: number;
  }) {
    this.assertLocal();
    const meeting = {
      id: Number(input.meetingNumber),
      uuid: `local-reconciled-${input.meetingNumber}`,
      password: randomBytes(6).toString("base64url"),
      hostId: input.expectedHostId,
      type: 2,
      topic: input.expectedTopic,
      startTime: input.expectedStartsAt,
      durationMinutes: input.expectedDurationMinutes,
      settings: {
        waiting_room: true,
        join_before_host: false,
        auto_recording: "none",
        meeting_authentication: false,
        approval_type: 0,
        registration_type: 1,
      },
    };
    const safety = attestExistingZoomMeetingSafety({
      meeting,
      hostSettings: {
        in_meeting: {
          allow_participants_to_rename: false,
          who_can_share_screen: "host",
          allow_removed_participants_to_rejoin: false,
        },
        recording: { cloud_recording: false },
      },
      expected: {
        meetingNumber: input.meetingNumber,
        hostId: input.expectedHostId,
        topic: input.expectedTopic,
        startsAt: input.expectedStartsAt,
        durationMinutes: input.expectedDurationMinutes,
      },
    });
    return {
      id: meeting.id,
      uuid: meeting.uuid,
      password: meeting.password,
      host_id: meeting.hostId,
      meetingType: 2 as const,
      topic: meeting.topic,
      startsAt: meeting.startTime,
      durationMinutes: meeting.durationMinutes,
      safety,
    };
  }

  async deleteMeeting() {
    this.assertLocal();
  }

  async updateMeeting() {
    this.assertLocal();
  }

  syntheticRegistrantEmail(domain = "zoom-id.suiyuecare.com") {
    this.assertLocal();
    return `${randomBytes(16).toString("hex")}@${domain}`;
  }

  async registerParticipant(input?: { customerKey?: string }) {
    this.assertLocal();
    if (
      input?.customerKey &&
      !/^[A-Za-z0-9_-]{1,36}$/.test(input.customerKey)
    ) {
      throw new Error("ZOOM_CUSTOMER_KEY_INVALID");
    }
    return {
      registrantId: `local-${randomBytes(8).toString("hex")}`,
      registrantToken: `local-${randomBytes(16).toString("base64url")}`,
    };
  }

  async revokeRegistrant() {
    this.assertLocal();
  }

  assertSafeJoinPayload(value: {
    passcode: string;
    zak?: string;
    url?: string;
  }) {
    this.assertLocal();
    if (
      value.url?.includes(value.passcode) ||
      (value.zak ? value.url?.includes(value.zak) : false)
    ) {
      throw new Error("ZOOM_EPHEMERAL_SECRET_LEAK");
    }
  }
}

export function zoomMeetingAdapter() {
  return localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  })
    ? new LocalZoomMeetingAdapter()
    : new ZoomMeetingAdapter();
}
