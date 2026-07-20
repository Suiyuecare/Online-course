import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-redirect";

describe("safeInternalPath", () => {
  it("keeps same-origin paths with query strings", () => {
    expect(safeInternalPath("/learn/course?lesson=one#video")).toBe(
      "/learn/course?lesson=one#video",
    );
  });

  it("rejects slash, backslash, and absolute external redirects", () => {
    expect(safeInternalPath("//evil.example/path")).toBe("/dashboard");
    expect(safeInternalPath("/\\evil.example/path")).toBe("/dashboard");
    expect(safeInternalPath("https://evil.example/path")).toBe("/dashboard");
  });
});
