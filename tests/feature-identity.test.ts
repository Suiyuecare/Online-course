import { describe, expect, it } from "vitest";
import {
  canUseFeature,
  DomainError,
  type LaunchReadiness,
} from "@/domain/feature-gates";
import {
  assertDistinctApprovers,
  assertFreshStepUp,
  assertUnrestrictedIdentity,
  localOtpAllowed,
} from "@/domain/identity";

const ready: LaunchReadiness = {
  maintenanceMode: false,
  providerHealthy: true,
  legalApproved: true,
  financeConfigured: true,
  operatingIdentityConfigured: true,
  incidentOwnerConfigured: true,
};

describe("fail-closed capabilities", () => {
  it("opens only an approved, enabled, unsuspended feature", () => {
    expect(
      canUseFeature(
        { enabled: true, approvedAt: new Date(), suspendedAt: null },
        ready,
      ),
    ).toBe(true);
  });

  it.each([
    ["missing gate", undefined],
    ["disabled", { enabled: false, approvedAt: new Date(), suspendedAt: null }],
    ["unapproved", { enabled: true, approvedAt: null, suspendedAt: null }],
    [
      "suspended",
      { enabled: true, approvedAt: new Date(), suspendedAt: new Date() },
    ],
  ])("closes when %s", (_, gate) => {
    expect(canUseFeature(gate, ready)).toBe(false);
  });

  it.each([
    "maintenanceMode",
    "providerHealthy",
    "legalApproved",
    "financeConfigured",
    "operatingIdentityConfigured",
    "incidentOwnerConfigured",
  ] as const)("closes when readiness %s fails", (field) => {
    const unavailable = { ...ready };
    if (field === "maintenanceMode") unavailable[field] = true;
    else unavailable[field] = false;
    expect(
      canUseFeature(
        { enabled: true, approvedAt: new Date(), suspendedAt: null },
        unavailable,
      ),
    ).toBe(false);
  });
});

describe("identity authority", () => {
  it("rejects a restricted identity", () => {
    expect(() =>
      assertUnrestrictedIdentity({
        active: true,
        restricted: true,
        identityEpoch: 3,
        sessionEpoch: 3,
      }),
    ).toThrowError(expect.objectContaining({ code: "IDENTITY_RESTRICTED" }));
  });

  it("rejects a stale session epoch after recovery or role change", () => {
    expect(() =>
      assertUnrestrictedIdentity({
        active: true,
        restricted: false,
        identityEpoch: 4,
        sessionEpoch: 3,
      }),
    ).toThrowError(expect.objectContaining({ code: "SESSION_EPOCH_STALE" }));
  });

  it("binds step-up to actor, action, target, nonce and epoch", () => {
    const now = new Date();
    expect(() =>
      assertFreshStepUp(
        {
          actorId: "actor-a",
          action: "certificate.revoke",
          target: "certificate-a",
          nonce: "nonce-a",
          identityEpoch: 8,
          issuedAt: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 60_000),
          consumedAt: null,
        },
        {
          actorId: "actor-a",
          action: "certificate.revoke",
          target: "certificate-b",
          nonce: "nonce-a",
          identityEpoch: 8,
          now,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "STEP_UP_REQUIRED" }));
  });

  it("rejects a consumed step-up grant", () => {
    const now = new Date();
    expect(() =>
      assertFreshStepUp(
        {
          actorId: "a",
          action: "x",
          target: "y",
          nonce: "n",
          identityEpoch: 1,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          consumedAt: now,
        },
        {
          actorId: "a",
          action: "x",
          target: "y",
          nonce: "n",
          identityEpoch: 1,
          now,
        },
      ),
    ).toThrow(DomainError);
  });

  it("requires distinct reviewers", () => {
    expect(() => assertDistinctApprovers("same", ["same"], 1)).toThrowError(
      expect.objectContaining({ code: "DUAL_CONTROL_REQUIRED" }),
    );
    expect(() =>
      assertDistinctApprovers("submitter", ["reviewer-a", "reviewer-b"], 2),
    ).not.toThrow();
  });

  it("allows fixed OTP only under all development gates", () => {
    expect(
      localOtpAllowed({
        nodeEnv: "development",
        appEnv: "development",
        allowMocks: "true",
        fixedOtp: "246810",
      }),
    ).toBe(true);
    expect(
      localOtpAllowed({
        nodeEnv: "production",
        appEnv: "development",
        allowMocks: "true",
        fixedOtp: "246810",
      }),
    ).toBe(false);
    expect(
      localOtpAllowed({
        nodeEnv: "development",
        appEnv: "development",
        allowMocks: "false",
        fixedOtp: "246810",
      }),
    ).toBe(false);
  });
});
