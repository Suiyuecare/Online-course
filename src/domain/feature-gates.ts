export const featureNames = [
  "b2c_commerce",
  "organization_topup",
  "organization_assignment",
  "recorded_playback",
  "live_booking",
  "zoom_join",
  "hybrid_completion",
  "accreditation_export",
  "certificate_issue",
] as const;

export type FeatureName = (typeof featureNames)[number];

export type FeatureGate = {
  enabled: boolean;
  approvedAt: Date | null;
  suspendedAt: Date | null;
};

export type LaunchReadiness = {
  maintenanceMode: boolean;
  providerHealthy: boolean;
  legalApproved: boolean;
  financeConfigured: boolean;
  operatingIdentityConfigured: boolean;
  incidentOwnerConfigured: boolean;
};

export function canUseFeature(
  gate: FeatureGate | undefined,
  readiness: LaunchReadiness,
): boolean {
  return Boolean(
    gate?.enabled &&
      gate.approvedAt &&
      !gate.suspendedAt &&
      !readiness.maintenanceMode &&
      readiness.providerHealthy &&
      readiness.legalApproved &&
      readiness.financeConfigured &&
      readiness.operatingIdentityConfigured &&
      readiness.incidentOwnerConfigured,
  );
}

export function assertFeatureOpen(
  name: FeatureName,
  gate: FeatureGate | undefined,
  readiness: LaunchReadiness,
): void {
  if (!canUseFeature(gate, readiness)) {
    throw new DomainError("FEATURE_CLOSED", `${name} is closed`);
  }
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
