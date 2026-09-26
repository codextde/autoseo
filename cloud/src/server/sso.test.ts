import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateSsoSecret, signSsoToken, SSO_MAX_LIFETIME_SECONDS, ssoUrl, verifySsoToken } from "./sso";
// The verifier that runs inside every managed instance (open-source app). Tokens must be byte-compatible.
import { verifySsoToken as instanceVerify } from "../../../src/server/auth/sso";

const secret = generateSsoSecret();
const now = 1_800_000_000;

describe("SSO tokens (docs/MANAGED_INSTANCES.md)", () => {
  it("uses 32 random bytes, hex encoded, as the instance secret", () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSsoSecret()).not.toBe(secret);
  });

  it("has the documented format: base64url(JSON {email, exp, nonce}) . base64url(HMAC-SHA256(secret, payload))", () => {
    const token = signSsoToken(secret, "owner@example.com", now);
    const [payload, sig] = token.split(".");
    expect(token.split(".")).toHaveLength(2);
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect(Object.keys(claims).sort()).toEqual(["email", "exp", "nonce"]);
    expect(claims.email).toBe("owner@example.com");
    expect(claims.exp).toBe(now + 120);
    expect(claims.nonce).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(sig).toBe(crypto.createHmac("sha256", secret).update(payload!).digest("base64url"));
  });

  it("round-trips with the cloud helper and the instance's own verifier", () => {
    const token = signSsoToken(secret, "owner@example.com", now);
    expect(verifySsoToken(secret, token, now)?.email).toBe("owner@example.com");
    expect(instanceVerify(secret, token, now)?.email).toBe("owner@example.com");
  });

  it("never issues tokens that live longer than five minutes", () => {
    const token = signSsoToken(secret, "owner@example.com", now, 3600);
    const claims = verifySsoToken(secret, token, now);
    expect(claims?.exp).toBe(now + SSO_MAX_LIFETIME_SECONDS);
    expect(instanceVerify(secret, token, now)).not.toBeNull();
  });

  it("rejects expired tokens, other secrets and tampering", () => {
    const token = signSsoToken(secret, "owner@example.com", now);
    expect(verifySsoToken(secret, token, now + 121)).toBeNull();
    expect(verifySsoToken(generateSsoSecret(), token, now)).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "attacker@example.com", exp: now + 60, nonce: "x" })).toString("base64url");
    expect(verifySsoToken(secret, `${forged}.${sig}`, now)).toBeNull();
    expect(verifySsoToken(secret, `${token}.extra`, now)).toBeNull();
    expect(verifySsoToken("", token, now)).toBeNull();
  });

  it("uses a fresh nonce for every token", () => {
    const a = verifySsoToken(secret, signSsoToken(secret, "a@example.com", now), now);
    const b = verifySsoToken(secret, signSsoToken(secret, "a@example.com", now), now);
    expect(a?.nonce).not.toBe(b?.nonce);
  });

  it("builds the instance sign-in URL", () => {
    expect(ssoUrl("acme.autoseo.codext.de", "a.b")).toBe("https://acme.autoseo.codext.de/auth/sso?token=a.b");
  });
});
