import crypto from "node:crypto";

/**
 * One-click sign-in tokens for managed instances (docs/MANAGED_INSTANCES.md):
 * `base64url(JSON {email, exp, nonce}) + "." + base64url(HMAC-SHA256(secret, payload))`.
 * Must stay byte-compatible with the instance-side verifier in the open-source app
 * (src/server/auth/sso.ts). Pure functions so they can be unit tested.
 */
export type SsoClaims = { email: string; exp: number; nonce: string };

export const SSO_MAX_LIFETIME_SECONDS = 5 * 60;
export const SSO_DEFAULT_TTL_SECONDS = 120;

function signature(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSsoToken(
  secret: string,
  email: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = SSO_DEFAULT_TTL_SECONDS,
): string {
  if (!secret) throw new Error("Missing SSO secret");
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), SSO_MAX_LIFETIME_SECONDS);
  const claims: SsoClaims = { email, exp: nowSeconds + ttl, nonce: crypto.randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

/** Mirror of the instance verifier: valid signature (timing-safe), not expired, lifetime ≤ 5 minutes. */
export function verifySsoToken(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): SsoClaims | null {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(signature(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let claims: SsoClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims?.email !== "string" || typeof claims.exp !== "number" || typeof claims.nonce !== "string") return null;
  if (claims.exp < nowSeconds || claims.exp > nowSeconds + SSO_MAX_LIFETIME_SECONDS) return null;
  return claims;
}

/** New per-instance AUTOSEO_SSO_SECRET: 32 random bytes, hex encoded. */
export function generateSsoSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function ssoUrl(host: string, token: string): string {
  return `https://${host}/auth/sso?token=${encodeURIComponent(token)}`;
}
