import { describe, expect, it } from "vitest";
import { claimSsoNonce, signSsoToken, verifySsoToken } from "./sso";

const secret = "a".repeat(64);
const now = 1_800_000_000;

describe("SSO tokens", () => {
  it("round-trips a valid token", () => {
    const token = signSsoToken(secret, "owner@example.com", now);
    expect(verifySsoToken(secret, token, now)?.email).toBe("owner@example.com");
  });

  it("rejects a wrong secret, tampered payload and expired tokens", () => {
    const token = signSsoToken(secret, "owner@example.com", now);
    expect(verifySsoToken("b".repeat(64), token, now)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "attacker@example.com", exp: now + 60, nonce: "x" })).toString("base64url");
    expect(verifySsoToken(secret, `${forged}.${sig}`, now)).toBeNull();
    expect(verifySsoToken(secret, `${payload}.${sig}`, now + 121)).toBeNull();
  });

  it("rejects tokens that live longer than five minutes", () => {
    const token = signSsoToken(secret, "owner@example.com", now, 3600);
    expect(verifySsoToken(secret, token, now)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifySsoToken(secret, "", now)).toBeNull();
    expect(verifySsoToken(secret, "a.b.c", now)).toBeNull();
    expect(verifySsoToken("", signSsoToken(secret, "x@example.com", now), now)).toBeNull();
  });

  it("allows each nonce only once", () => {
    expect(claimSsoNonce("n1", now + 60, now)).toBe(true);
    expect(claimSsoNonce("n1", now + 60, now)).toBe(false);
    expect(claimSsoNonce("n2", now + 60, now)).toBe(true);
  });
});
