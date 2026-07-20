import { describe, expect, it } from "vitest";
import {
  calculateEnterpriseOrder,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenMatches,
  isInvitationUnexpired,
  normalizeEmail,
  normalizeTaxId,
  selectPriceTier,
  type PriceTier,
} from "./enterprise-core";

const tiers: PriceTier[] = [
  {
    id: "tier-5",
    min_quantity: 5,
    max_quantity: 9,
    unit_price_twd: 900,
    effective_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    active: true,
  },
  {
    id: "tier-10",
    min_quantity: 10,
    max_quantity: null,
    unit_price_twd: 800,
    effective_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    active: true,
  },
];

describe("enterprise core", () => {
  it("normalizes identity inputs", () => {
    expect(normalizeEmail(" Staff@Example.COM ")).toBe("staff@example.com");
    expect(normalizeTaxId("12-345-678")).toBe("12345678");
  });

  it("selects the authoritative quantity tier", () => {
    const now = new Date("2026-07-20T00:00:00Z");
    expect(selectPriceTier(tiers, 4, now)).toBeNull();
    expect(selectPriceTier(tiers, 5, now)?.id).toBe("tier-5");
    expect(selectPriceTier(tiers, 10, now)?.id).toBe("tier-10");
    expect(calculateEnterpriseOrder(tiers, 12, now)?.totalAmountTwd).toBe(
      9600,
    );
  });

  it("uses non-reversible invitation token hashes", () => {
    const token = createInvitationToken();
    const hash = hashInvitationToken(token);
    expect(hash).not.toContain(token);
    expect(invitationTokenMatches(token, hash)).toBe(true);
    expect(invitationTokenMatches(`${token}x`, hash)).toBe(false);
  });

  it("checks invitation expiry against an explicit clock", () => {
    expect(
      isInvitationUnexpired("2026-07-21T00:00:00Z", Date.parse("2026-07-20T00:00:00Z")),
    ).toBe(true);
    expect(
      isInvitationUnexpired("2026-07-19T00:00:00Z", Date.parse("2026-07-20T00:00:00Z")),
    ).toBe(false);
  });
});
