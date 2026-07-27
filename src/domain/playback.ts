import { DomainError } from "./feature-gates";

export const PLAYBACK_HEARTBEAT_SECONDS = 15;
export const PRESENCE_BLOCK_SECONDS = 10 * 60;
export const PRESENCE_RESPONSE_SECONDS = 90;
export const PLAYBACK_TOKEN_REFRESH_LEAD_SECONDS = 5 * 60;

export function playbackTokenRefreshDelayMs(
  expiresAt: string,
  nowMs = Date.now(),
): number {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) {
    throw new DomainError(
      "PLAYBACK_TOKEN_EXPIRY_INVALID",
      "signed playback token expiry is invalid",
    );
  }
  return Math.max(
    0,
    expiryMs - nowMs - PLAYBACK_TOKEN_REFRESH_LEAD_SECONDS * 1000,
  );
}

export type PlaybackHeartbeat = {
  sequence: number;
  mediaPositionSeconds: number;
  receivedAtMs: number;
  playing: boolean;
  visible: boolean;
  online: boolean;
  leaseEpoch: number;
};

export function candidateSeconds(
  previous: PlaybackHeartbeat | null,
  current: PlaybackHeartbeat,
  activeLeaseEpoch: number,
): number {
  if (
    !previous ||
    current.sequence !== previous.sequence + 1 ||
    current.leaseEpoch !== activeLeaseEpoch ||
    previous.leaseEpoch !== activeLeaseEpoch ||
    !previous.playing ||
    !previous.visible ||
    !previous.online ||
    !current.playing ||
    !current.visible ||
    !current.online
  ) {
    return 0;
  }
  const receivedDelta = (current.receivedAtMs - previous.receivedAtMs) / 1000;
  const mediaDelta =
    current.mediaPositionSeconds - previous.mediaPositionSeconds;
  if (
    receivedDelta <= 0 ||
    receivedDelta > 45 ||
    mediaDelta < 0 ||
    mediaDelta > receivedDelta + 3
  ) {
    return 0;
  }
  return Math.floor(
    Math.min(receivedDelta, mediaDelta, PLAYBACK_HEARTBEAT_SECONDS + 2),
  );
}

export function presenceBlockTarget(
  confirmedSeconds: number,
  candidateUnconfirmedSeconds: number,
  requiredSeconds: number,
): number | null {
  const remaining = requiredSeconds - confirmedSeconds;
  if (remaining <= 0) return null;
  const nextBlock = Math.min(PRESENCE_BLOCK_SECONDS, remaining);
  return candidateUnconfirmedSeconds >= nextBlock ? nextBlock : null;
}

export function confirmPresence(input: {
  challengeExpiresAtMs: number;
  confirmedAtMs: number;
  consumed: boolean;
  blockSeconds: number;
}): number {
  if (input.consumed)
    throw new DomainError(
      "CHALLENGE_CONSUMED",
      "challenge was already consumed",
    );
  if (input.confirmedAtMs > input.challengeExpiresAtMs)
    throw new DomainError("CHALLENGE_EXPIRED", "presence response is late");
  if (input.blockSeconds <= 0 || input.blockSeconds > PRESENCE_BLOCK_SECONDS)
    throw new DomainError("INVALID_BLOCK", "invalid presence block");
  return input.blockSeconds;
}
