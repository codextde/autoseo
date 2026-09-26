import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safe-url";

describe("safeHttpUrl (provider-returned links)", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(safeHttpUrl("https://linear.app/team/issue/ABC-1")).toBe("https://linear.app/team/issue/ABC-1");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.com", "/relative", "", null, undefined])
      expect(safeHttpUrl(bad as string | null | undefined)).toBeNull();
  });
});
