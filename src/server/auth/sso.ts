import crypto from "node:crypto";

/**
 * One-click sign-in tokens issued by AutoSEO Cloud (docs/MANAGED_INSTANCES.md):
 * `base64url(JSON {email, exp, nonce}) + "." + base64url(HMAC-SHA256(secret, payload))`.
 * Pure functions (no server-only import) so they can be unit tested.
 */
export type SsoClaims = { email: string; exp: number; nonce: string };

const MAX_LIFETIME_SECONDS = 5 * 60;

function signature(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSsoToken(secret: string, email: string, nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = 120): string {
  const claims: SsoClaims = { email, exp: nowSeconds + ttlSeconds, nonce: crypto.randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

/** Returns the claims of a valid, unexpired token (lifetime capped at 5 minutes), otherwise null. */
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
  if (claims.exp < nowSeconds || claims.exp > nowSeconds + MAX_LIFETIME_SECONDS) return null;
  return claims;
}

const usedNonces = new Map<string, number>();

/** Single use: returns false when the nonce was already redeemed (kept until the token would expire). */
export function claimSsoNonce(nonce: string, exp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  for (const [key, until] of usedNonces) if (until < nowSeconds) usedNonces.delete(key);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, exp);
  return true;
}
