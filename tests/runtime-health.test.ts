import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeHealth,
  requiredProductionProviders,
} from "@/domain/runtime-health";

const now = new Date("2026-07-24T12:00:00.000Z");

function healthySignals() {
  return {
    now,
    configuration: { auth: true, operations: true },
    emergencyClosed: false,
    databaseConnected: true,
    providers: requiredProductionProviders.map((provider) => ({
      provider,
      status: "healthy",
      checkedAt: "2026-07-24T11:55:00.000Z",
      productionValidatedAt: "2026-07-20T00:00:00.000Z",
      productionValidationExpiresAt: "2026-10-18T00:00:00.000Z",
    })),
    workerLastSuccessAt: "2026-07-24T11:50:00.000Z",
    oldestDueJobCreatedAt: null,
    deadLetterCount: 0,
  };
}

describe("runtime production health", () => {
  it("is ready only when configuration and live dependencies are healthy", () => {
    const result = evaluateRuntimeHealth(healthySignals());
    expect(result.status).toBe("ready");
    expect(result.reasons).toEqual([]);
  });

  it("fails closed for stale provider checks", () => {
    const signals = healthySignals();
    signals.providers[0] = {
      ...signals.providers[0]!,
      checkedAt: "2026-07-24T11:44:59.000Z",
    };
    const result = evaluateRuntimeHealth(signals);
    expect(result.status).toBe("closed");
    expect(result.dependencies.providers).toBe(false);
  });

  it("fails closed when production validation evidence has expired", () => {
    const signals = healthySignals();
    signals.providers[0] = {
      ...signals.providers[0]!,
      productionValidationExpiresAt: "2026-07-24T12:00:00.000Z",
    };
    const result = evaluateRuntimeHealth(signals);
    expect(result.status).toBe("closed");
    expect(result.dependencies.providers).toBe(false);
  });

  it("fails closed for a stale worker, overdue work, or dead letters", () => {
    const result = evaluateRuntimeHealth({
      ...healthySignals(),
      workerLastSuccessAt: "2026-07-24T11:39:59.000Z",
      oldestDueJobCreatedAt: "2026-07-24T11:44:59.000Z",
      deadLetterCount: 1,
    });
    expect(result.status).toBe("closed");
    expect(result.dependencies.worker).toBe(false);
    expect(result.dependencies.queue).toBe(false);
  });
});
