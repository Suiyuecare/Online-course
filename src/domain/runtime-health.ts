export const requiredProductionProviders = [
  "supabase_phone_auth",
  "twilio_verify",
  "cloudflare_stream",
  "zoom_oauth",
  "zoom_meeting_sdk",
  "resend",
  "managed_kms",
  "malware_scanner",
  "external_monitor",
] as const;

export type ProviderHealthSignal = {
  provider: string;
  status: string;
  checkedAt: string | null;
  productionValidatedAt: string | null;
  productionValidationExpiresAt: string | null;
};

export type RuntimeHealthSignals = {
  now: Date;
  configuration: Record<string, boolean>;
  emergencyClosed: boolean;
  databaseConnected: boolean;
  providers: ProviderHealthSignal[];
  workerLastSuccessAt: string | null;
  oldestDueJobCreatedAt: string | null;
  oldestDueNotificationCreatedAt: string | null;
  durableDeadLetterCount: number;
  notificationDeadLetterCount: number;
};

const providerFreshnessMs = 15 * 60 * 1000;
const workerFreshnessMs = 20 * 60 * 1000;
const maximumDueJobAgeMs = 15 * 60 * 1000;

function isFresh(value: string | null, now: Date, maximumAgeMs: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  const age = now.getTime() - timestamp;
  return Number.isFinite(timestamp) && age >= -60_000 && age <= maximumAgeMs;
}

function isUnexpired(value: string | null, now: Date) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function evaluateRuntimeHealth(signals: RuntimeHealthSignals) {
  const configuration = Object.values(signals.configuration).every(Boolean);
  const providerMap = new Map(
    signals.providers.map((provider) => [provider.provider, provider]),
  );
  const providers = requiredProductionProviders.every((required) => {
    const provider = providerMap.get(required);
    return Boolean(
      provider &&
        provider.status === "healthy" &&
        provider.productionValidatedAt &&
        isUnexpired(provider.productionValidationExpiresAt, signals.now) &&
        isFresh(provider.checkedAt, signals.now, providerFreshnessMs),
    );
  });
  const worker = isFresh(
    signals.workerLastSuccessAt,
    signals.now,
    workerFreshnessMs,
  );
  const queue =
    signals.durableDeadLetterCount === 0 &&
    signals.notificationDeadLetterCount === 0 &&
    (!signals.oldestDueJobCreatedAt ||
      isFresh(
        signals.oldestDueJobCreatedAt,
        signals.now,
        maximumDueJobAgeMs,
      )) &&
    (!signals.oldestDueNotificationCreatedAt ||
      isFresh(
        signals.oldestDueNotificationCreatedAt,
        signals.now,
        maximumDueJobAgeMs,
      ));
  const dependencies = {
    configuration,
    database: signals.databaseConnected,
    providers,
    worker,
    queue,
  };
  const ready =
    !signals.emergencyClosed && Object.values(dependencies).every(Boolean);

  return {
    status: ready ? ("ready" as const) : ("closed" as const),
    dependencies,
    reasons: [
      ...(signals.emergencyClosed ? ["emergency_closed"] : []),
      ...Object.entries(dependencies)
        .filter(([, healthy]) => !healthy)
        .map(([dependency]) => `${dependency}_unavailable`),
    ],
  };
}
