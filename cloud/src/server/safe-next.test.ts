import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps relative paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/dashboard?checkout=success#x")).toBe("/dashboard?checkout=success#x");
  });

  it("rejects absolute, protocol-relative and tricky targets", () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "/ /evil",
      "dashboard",
      "/.//evil.com",
      "/..//evil.com",
      "/%2e%2e//evil.com",
      "/a/../..//evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(next as string), String(next)).toBeNull();
    }
  });
});
