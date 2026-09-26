import "server-only";
import crypto from "node:crypto";
import { hmac, randomToken, sha256 } from "@/server/crypto";

/** 24 random bytes → 32-char base64url token (open-seo compatible shape). */
export function mintShareToken(): string {
  return randomToken(24);
}

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export const SHARE_PASSWORD_MIN = 8;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashSharePassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifySharePassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (!expected.length || password.length > 1024) return false;
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Cookie that remembers a successful password entry for one share link. */
export function shareCookieName(token: string): string {
  return `rshare_${sha256(token).slice(0, 16)}`;
}

/** Changes whenever the password changes, so old unlock cookies stop working. */
export function shareCookieValue(token: string, passwordHash: string): string {
  return hmac(`${token}:${passwordHash}`, "report-share");
}
