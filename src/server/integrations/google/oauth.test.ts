import { describe, expect, it } from "vitest";
import { sanitizeReturnPath, signState, verifyState } from "./oauth";

describe("google oauth state", () => {
  const payload = { p: "prj_demo0000000001", k: "gsc" as const, u: "usr_1", r: "/p/prj_demo0000000001/integrations", n: "nonce", e: Date.now() + 60_000 };

  it("round-trips a signed state", () => {
    expect(verifyState(signState(payload))).toEqual(payload);
  });

  it("rejects tampered, expired or malformed states", () => {
    const state = signState(payload);
    const [body, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, p: "prj_other" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.${"0".repeat(sig!.length)}`)).toBeNull();
    expect(verifyState(signState({ ...payload, e: Date.now() - 1 }))).toBeNull();
    expect(verifyState(signState({ ...payload, k: "xx" as never }))).toBeNull();
    expect(verifyState("garbage")).toBeNull();
    expect(verifyState(null)).toBeNull();
  });
});

describe("sanitizeReturnPath", () => {
  it("only allows same-origin paths", () => {
    expect(sanitizeReturnPath("/p/x/integrations?connect=a", "/fallback")).toBe("/p/x/integrations?connect=a");
    expect(sanitizeReturnPath("//evil.com/x", "/fallback")).toBe("/fallback");
    expect(sanitizeReturnPath("https://evil.com", "/fallback")).toBe("/fallback");
    expect(sanitizeReturnPath("/\\evil.com", "/fallback")).toBe("/fallback");
    expect(sanitizeReturnPath(null, "/fallback")).toBe("/fallback");
  });
});

describe("sanitizeReturnPath control characters", () => {
  it("rejects paths that URL parsing would turn into another origin", () => {
    expect(sanitizeReturnPath("/\t/evil.com", "/fallback")).toBe("/fallback");
    expect(sanitizeReturnPath("/\n/evil.com", "/fallback")).toBe("/fallback");
    expect(sanitizeReturnPath("/p/x?y=1#z", "/fallback")).toBe("/p/x?y=1#z");
  });
});

describe("google oauth intents", () => {
  it("accepts every supported intent in the signed state", () => {
    for (const k of ["gsc", "ga4", "sheets", "account"] as const) {
      const p = { p: "prj_demo0000000001", k, u: "usr_1", r: "/x", n: "n", e: Date.now() + 60_000 };
      expect(verifyState(signState(p))?.k).toBe(k);
    }
  });
});
