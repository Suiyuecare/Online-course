export type EmergencySwitches = {
  allDisabled: boolean;
  paymentsDisabled: boolean;
  exportsDisabled: boolean;
  certificatesDisabled: boolean;
};

export type EmergencyCapability = "payments" | "exports" | "certificates";

export const highFrequencyRateLimitPlan = {
  perAuthenticatedPersonPerMinute: 12,
  perNetworkPerMinute: 2_000,
} as const;

const uuidPathSegment =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function rateLimitAction(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (uuidPathSegment.test(segment) ? ":id" : segment))
    .join("/");
}

export function usesAuthenticatedHighFrequencyLimit(pathname: string): boolean {
  return (
    pathname === "/api/live/heartbeat" || pathname === "/api/playback/heartbeat"
  );
}

const emergencyControlPaths = new Set([
  "/api/auth/otp/request",
  "/api/auth/otp/verify",
  "/api/profile/recovery",
  "/api/staff/security/emergency-suspend",
  "/api/staff/step-up",
]);

const emergencyRemediationPatterns = [
  /^\/api\/orders\/[^/]+\/refunds$/,
  /^\/api\/staff\/refunds(?:\/.*)?$/,
  /^\/api\/organizations\/[^/]+\/point-refunds$/,
  /^\/api\/staff\/organizations\/point-refunds(?:\/.*)?$/,
  /^\/api\/staff\/certificates\/revocations(?:\/.*)?$/,
  /^\/api\/staff\/identity\/recoveries(?:\/.*)?$/,
  /^\/api\/staff\/operations\/incidents(?:\/.*)?$/,
  /^\/api\/staff\/operations\/dead-letters(?:\/.*)?$/,
  /^\/api\/staff\/operations\/evidence$/,
];

const paymentMutationPatterns = [
  /^\/api\/orders$/,
  /^\/api\/orders\/[^/]+\/proof$/,
  /^\/api\/organizations\/[^/]+\/topups$/,
  /^\/api\/organizations\/topups\/[^/]+\/proof$/,
  /^\/api\/staff\/finance\/(?:allocate|confirm|bank-imports)(?:\/.*)?$/,
  /^\/api\/staff\/finance\/invoices\/[^/]+\/result$/,
];

const exportPatterns = [
  /^\/api\/staff\/accreditation\/exports(?:\/.*)?$/,
  /^\/api\/organizations\/[^/]+\/reports(?:\/.*)?$/,
];

const certificatePatterns = [
  /^\/api\/certificates\/[^/]+\/download$/,
  /^\/api\/staff\/certificates\/issue(?:\/.*)?$/,
];

function matchesAny(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(pathname));
}

function isEmergencyRecoveryPath(pathname: string): boolean {
  return (
    emergencyControlPaths.has(pathname) ||
    matchesAny(pathname, emergencyRemediationPatterns)
  );
}

export function inferEmergencyCapability(
  pathname: string,
): EmergencyCapability | null {
  if (matchesAny(pathname, paymentMutationPatterns)) return "payments";
  if (matchesAny(pathname, exportPatterns)) return "exports";
  if (matchesAny(pathname, certificatePatterns)) return "certificates";
  return null;
}

export function emergencyClosureCode(
  switches: EmergencySwitches,
  pathname: string,
  explicitCapability?: EmergencyCapability,
): string | null {
  if (switches.allDisabled && !isEmergencyRecoveryPath(pathname)) {
    return "PLATFORM_EMERGENCY_CLOSED";
  }

  const capability = explicitCapability ?? inferEmergencyCapability(pathname);
  if (capability === "payments" && switches.paymentsDisabled) {
    return "PAYMENTS_EMERGENCY_CLOSED";
  }
  if (capability === "exports" && switches.exportsDisabled) {
    return "EXPORTS_EMERGENCY_CLOSED";
  }
  if (capability === "certificates" && switches.certificatesDisabled) {
    return "CERTIFICATES_EMERGENCY_CLOSED";
  }
  return null;
}

export function isExactSameOrigin(
  requestUrl: string,
  originHeader: string | null,
  secFetchSite: string | null,
): boolean {
  if (!originHeader) return secFetchSite === "same-origin";

  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
