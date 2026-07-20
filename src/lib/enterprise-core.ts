import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ENTERPRISE_INVITE_DAYS = 7;
export const ENTERPRISE_SEAT_VALID_DAYS = 365;
export const ENTERPRISE_LIVE_CHANGE_HOURS = 24;
export const ENTERPRISE_MAX_IMPORT_ROWS = 1000;

export type OrganizationRole = "owner" | "manager" | "member";

export type PriceTier = {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_price_twd: number;
  effective_at: string;
  expires_at: string | null;
  active: boolean;
};

export function isEnterpriseEnabled() {
  return process.env.FEATURE_ENTERPRISE === "true";
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeTaxId(value: string) {
  return value.replace(/\D/g, "");
}

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationTokenMatches(token: string, expectedHash: string) {
  const received = Buffer.from(hashInvitationToken(token));
  const expected = Buffer.from(expectedHash);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function isInvitationUnexpired(
  expiresAt: string,
  currentTime = Date.now(),
) {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > currentTime;
}

export function canManageOrganization(role: OrganizationRole | null) {
  return role === "owner" || role === "manager";
}

export function canEditOrganization(role: OrganizationRole | null) {
  return role === "owner";
}

export function selectPriceTier(
  tiers: PriceTier[],
  quantity: number,
  now = new Date(),
) {
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  const timestamp = now.getTime();
  return (
    tiers
      .filter(
        (tier) =>
          tier.active &&
          quantity >= tier.min_quantity &&
          (tier.max_quantity === null || quantity <= tier.max_quantity) &&
          Date.parse(tier.effective_at) <= timestamp &&
          (!tier.expires_at || Date.parse(tier.expires_at) > timestamp),
      )
      .sort((a, b) => b.min_quantity - a.min_quantity)[0] ?? null
  );
}

export function calculateEnterpriseOrder(
  tiers: PriceTier[],
  quantity: number,
  now = new Date(),
) {
  const tier = selectPriceTier(tiers, quantity, now);
  if (!tier) return null;
  return {
    tier,
    quantity,
    unitPriceTwd: tier.unit_price_twd,
    totalAmountTwd: tier.unit_price_twd * quantity,
  };
}

export function seatExpiryDate(paidAt = new Date()) {
  const expiresAt = new Date(paidAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ENTERPRISE_SEAT_VALID_DAYS);
  return expiresAt;
}
