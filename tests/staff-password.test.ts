import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isProtectedStaffMetadata,
  mustChangeStaffPassword,
  staffPasswordSchema,
} from "@/domain/staff-password";

describe("staff credential safeguards", () => {
  it("requires a long mixed-character password without whitespace", () => {
    expect(staffPasswordSchema.safeParse("Longer!Password2026").success).toBe(
      true,
    );
    for (const password of [
      "Short!1a",
      "alllowercase!2026",
      "ALLUPPERCASE!2026",
      "NoNumbersIncluded!",
      "NoSymbolsIncluded2026",
      "Has whitespace!2026A",
    ]) {
      expect(staffPasswordSchema.safeParse(password).success).toBe(false);
    }
  });

  it("trusts only the protected staff metadata contract", () => {
    const metadata = {
      account_type: "staff",
      staff_login: true,
      must_change_password: true,
    };
    expect(isProtectedStaffMetadata(metadata)).toBe(true);
    expect(mustChangeStaffPassword(metadata)).toBe(true);
    expect(
      isProtectedStaffMetadata({ account_type: "learner", staff_login: true }),
    ).toBe(false);
    expect(
      isProtectedStaffMetadata({ account_type: "staff", staff_login: false }),
    ).toBe(false);
  });

  it("challenges an existing TOTP factor on every new AAL1 login", () => {
    const setup = readFileSync(
      resolve(process.cwd(), "src/components/staff-mfa-setup.tsx"),
      "utf8",
    );
    expect(setup).toContain("getAuthenticatorAssuranceLevel()");
    expect(setup).toContain('currentLevel === "aal2"');
    expect(setup).toContain("existingFactorId");
    expect(setup).toContain("void verifyFactor(");
  });
});
