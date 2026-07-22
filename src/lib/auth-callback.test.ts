import { describe, expect, it } from "vitest";
import { authCallbackDestinations } from "./auth-callback";

describe("authCallbackDestinations", () => {
  it("preserves a safe destination after a callback retry", () => {
    expect(authCallbackDestinations("/checkout/course?session=one")).toEqual({
      success: "/checkout/course?session=one",
      failure:
        "/login?error=auth_callback&next=%2Fcheckout%2Fcourse%3Fsession%3Done",
    });
  });

  it("never forwards an external callback destination", () => {
    expect(authCallbackDestinations("https://evil.example/path")).toEqual({
      success: "/dashboard",
      failure: "/login?error=auth_callback&next=%2Fdashboard",
    });
  });
});
