import { DomainError } from "./feature-gates";

export type IdentityAccess = {
  active: boolean;
  restricted: boolean;
  identityEpoch: number;
  sessionEpoch: number;
};

export function assertUnrestrictedIdentity(identity: IdentityAccess): void {
  if (!identity.active) throw new DomainError("IDENTITY_INACTIVE", "inactive");
  if (identity.restricted)
    throw new DomainError("IDENTITY_RESTRICTED", "restricted");
  if (identity.identityEpoch !== identity.sessionEpoch)
    throw new DomainError("SESSION_EPOCH_STALE", "stale session");
}

export type StepUpGrant = {
  actorId: string;
  action: string;
  target: string;
  nonce: string;
  identityEpoch: number;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export function assertFreshStepUp(
  grant: StepUpGrant,
  request: {
    actorId: string;
    action: string;
    target: string;
    nonce: string;
    identityEpoch: number;
    now: Date;
  },
): void {
  const sameBinding =
    grant.actorId === request.actorId &&
    grant.action === request.action &&
    grant.target === request.target &&
    grant.nonce === request.nonce &&
    grant.identityEpoch === request.identityEpoch;
  if (!sameBinding || grant.consumedAt || grant.expiresAt <= request.now) {
    throw new DomainError("STEP_UP_REQUIRED", "fresh TOTP is required");
  }
  if (request.now.getTime() - grant.issuedAt.getTime() > 5 * 60_000) {
    throw new DomainError("STEP_UP_EXPIRED", "step-up grant is too old");
  }
}

export function assertDistinctApprovers(
  submitterId: string,
  reviewerIds: string[],
  required = 1,
): void {
  const distinct = new Set(reviewerIds.filter((id) => id !== submitterId));
  if (distinct.size < required) {
    throw new DomainError("DUAL_CONTROL_REQUIRED", "distinct review required");
  }
}

export function localOtpAllowed(input: {
  nodeEnv: string | undefined;
  appEnv: string | undefined;
  allowMocks: string | undefined;
  fixedOtp: string | undefined;
}): boolean {
  return (
    input.nodeEnv !== "production" &&
    input.appEnv === "development" &&
    input.allowMocks === "true" &&
    /^[0-9]{6}$/.test(input.fixedOtp ?? "")
  );
}

export function localProvidersAllowed(input: {
  nodeEnv: string | undefined;
  appEnv: string | undefined;
  allowMocks: string | undefined;
}): boolean {
  return (
    input.nodeEnv !== "production" &&
    input.appEnv === "development" &&
    input.allowMocks === "true"
  );
}
