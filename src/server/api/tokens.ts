import "server-only";
import { customAlphabet } from "nanoid";
import { sha256 } from "@/server/crypto";

// Base62, 40 chars ≈ 238 bits of entropy.
const base62 = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 40);

/** Generates a secret credential like `as_live_9f3a2c…` (only the SHA-256 hash is ever stored). */
export function generateSecret(prefix: string): { token: string; hash: string; displayPrefix: string } {
  const token = `${prefix}${base62()}`;
  return { token, hash: hashSecret(token), displayPrefix: token.slice(0, prefix.length + 6) };
}

export function hashSecret(token: string): string {
  return sha256(token);
}

/** Extracts a bearer credential from `Authorization: Bearer …` or `x-api-key`. */
export function readBearer(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const key = headers.get("x-api-key");
  return key?.trim() || null;
}
