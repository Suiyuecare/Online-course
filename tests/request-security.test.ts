import { describe, expect, it } from "vitest";
import { assertExpectedAccount } from "@/app/api/_shared/route-helpers";
import {
  emergencyClosureCode,
  highFrequencyRateLimitPlan,
  inferEmergencyCapability,
  isExactSameOrigin,
  rateLimitAction,
  type EmergencySwitches,
  usesAuthenticatedHighFrequencyLimit,
} from "@/domain/request-security";

const open: EmergencySwitches = {
  allDisabled: false,
  paymentsDisabled: false,
  exportsDisabled: false,
  certificatesDisabled: false,
};

describe("exact same-origin mutation protection", () => {
  it("requires the same scheme, host and port", () => {
    expect(
      isExactSameOrigin(
        "https://class.suiyuecare.com/api/orders",
        "https://class.suiyuecare.com",
        "same-origin",
      ),
    ).toBe(true);
    expect(
      isExactSameOrigin(
        "https://class.suiyuecare.com/api/orders",
        "http://class.suiyuecare.com",
        "same-origin",
      ),
    ).toBe(false);
    expect(
      isExactSameOrigin(
        "http://localhost:3000/api/orders",
        "http://localhost:3001",
        "same-origin",
      ),
    ).toBe(false);
  });

  it("accepts an origin-less same-origin browser request only with Fetch Metadata", () => {
    expect(
      isExactSameOrigin(
        "https://class.suiyuecare.com/api/orders",
        null,
        "same-origin",
      ),
    ).toBe(true);
    expect(
      isExactSameOrigin("https://class.suiyuecare.com/api/orders", null, null),
    ).toBe(false);
    expect(
      isExactSameOrigin(
        "https://class.suiyuecare.com/api/orders",
        "not a URL",
        "same-origin",
      ),
    ).toBe(false);
  });
});

describe("authenticated page version binding", () => {
  const accountId = "a1000000-0000-4000-8000-000000000001";

  it("requires the rendered account id to match the current session", () => {
    expect(() =>
      assertExpectedAccount(
        new Request("https://class.suiyuecare.com/api/orders", {
          headers: { "x-suiyue-account-id": accountId },
        }),
        accountId,
      ),
    ).not.toThrow();
    for (const header of [null, "a1000000-0000-4000-8000-000000000002"]) {
      const request = new Request(
        "https://class.suiyuecare.com/api/orders",
        header ? { headers: { "x-suiyue-account-id": header } } : undefined,
      );
      expect(() => assertExpectedAccount(request, accountId)).toThrow(
        "LEARNER_ACCOUNT_VERSION_CONFLICT",
      );
    }
  });
});

describe("server emergency closures", () => {
  it("closes normal mutations globally while preserving the protected control path", () => {
    const closed = { ...open, allDisabled: true };
    expect(emergencyClosureCode(closed, "/api/orders")).toBe(
      "PLATFORM_EMERGENCY_CLOSED",
    );
    expect(
      emergencyClosureCode(closed, "/api/staff/security/emergency-suspend"),
    ).toBeNull();
    expect(emergencyClosureCode(closed, "/api/staff/step-up")).toBeNull();
    expect(emergencyClosureCode(closed, "/api/auth/otp/verify")).toBeNull();
    expect(
      emergencyClosureCode(closed, "/api/orders/order-id/refunds"),
    ).toBeNull();
    expect(
      emergencyClosureCode(
        closed,
        "/api/staff/certificates/revocations/request-id/decision",
      ),
    ).toBeNull();
  });

  it("closes new payment and proof operations but preserves refunds", () => {
    const closed = { ...open, paymentsDisabled: true };
    expect(emergencyClosureCode(closed, "/api/orders")).toBe(
      "PAYMENTS_EMERGENCY_CLOSED",
    );
    expect(emergencyClosureCode(closed, "/api/orders/order-id/proof")).toBe(
      "PAYMENTS_EMERGENCY_CLOSED",
    );
    expect(
      emergencyClosureCode(closed, "/api/orders/order-id/refunds"),
    ).toBeNull();
    expect(
      emergencyClosureCode(
        closed,
        "/api/staff/refunds/disbursements/disbursement-id/confirm",
      ),
    ).toBeNull();
  });

  it("classifies export and certificate download paths", () => {
    expect(
      inferEmergencyCapability("/api/staff/accreditation/exports/download"),
    ).toBe("exports");
    expect(
      inferEmergencyCapability("/api/organizations/org-id/reports/training"),
    ).toBe("exports");
    expect(
      inferEmergencyCapability("/api/certificates/certificate-id/download"),
    ).toBe("certificates");
  });
});

describe("high-frequency authenticated rate-limit routing", () => {
  it("collapses UUID route parameters into one rate-limit bucket", () => {
    expect(
      rateLimitAction(
        "/api/orders/9ae5c441-2b61-4dda-baa2-fc0018b6306d/refunds",
      ),
    ).toBe("/api/orders/:id/refunds");
    expect(
      rateLimitAction(
        "/api/orders/24b24412-04ea-49b7-a6f6-f70dc5b32e4f/refunds",
      ),
    ).toBe("/api/orders/:id/refunds");
    expect(rateLimitAction("/api/auth/otp/request")).toBe(
      "/api/auth/otp/request",
    );
  });

  it("uses a person-scoped limit for learner heartbeats", () => {
    expect(usesAuthenticatedHighFrequencyLimit("/api/live/heartbeat")).toBe(
      true,
    );
    expect(usesAuthenticatedHighFrequencyLimit("/api/playback/heartbeat")).toBe(
      true,
    );
    expect(usesAuthenticatedHighFrequencyLimit("/api/auth/otp/request")).toBe(
      false,
    );
    expect(
      highFrequencyRateLimitPlan.perNetworkPerMinute,
    ).toBeGreaterThanOrEqual(200 * 4);
    expect(
      highFrequencyRateLimitPlan.perAuthenticatedPersonPerMinute,
    ).toBeGreaterThanOrEqual(4);
  });
});
