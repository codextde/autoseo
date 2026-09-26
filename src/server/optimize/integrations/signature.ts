import crypto from "node:crypto";

/**
 * Outgoing webhook signatures (pure, isomorphic within Node — no server-only / alias imports so it can be unit tested).
 * Signature = hex HMAC-SHA256 of `${timestamp}.${body}` keyed with the per-integration signing secret.
 * Receivers verify with: `sha256=` + hmac(secret, `${X-AutoSEO-Timestamp}.${rawBody}`) === X-AutoSEO-Signature.
 */
export const SIGNATURE_HEADER = "X-AutoSEO-Signature";
export const TIMESTAMP_HEADER = "X-AutoSEO-Timestamp";
export const EVENT_HEADER = "X-AutoSEO-Event";

export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, timestamp: string | number, body: string): string {
  const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${mac}`;
}

/** Constant-time verification with a tolerance window (seconds) against replay. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string | number,
  body: string,
  signature: string,
  opts: { toleranceSec?: number; now?: number } = {},
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSec ?? 300)) return false;
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/** Headers for one delivery. */
export function webhookHeaders(secret: string, event: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  return {
    "content-type": "application/json",
    [EVENT_HEADER]: event,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, body),
  };
}
