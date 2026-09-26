import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/server/env";

let cachedKey: Buffer | null = null;

/**
 * Master key used to encrypt secrets at rest. Generated once into the data volume so a database
 * dump alone never reveals SMTP passwords, API keys or OAuth tokens.
 */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cachedKey = crypto.createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  const file = path.join(env.dataDir, "secret.key");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 64) {
      cachedKey = Buffer.from(existing, "hex");
      return cachedKey;
    }
  } catch {
    // generate below
  }
  fs.mkdirSync(env.dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  cachedKey = key;
  return key;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(payload: string): T {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Invalid secret payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token (default 32 bytes of entropy). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Human-friendly numeric code, e.g. for email one-time codes. */
export function randomDigits(length = 6): string {
  let out = "";
  while (out.length < length) out += crypto.randomInt(0, 10).toString();
  return out;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hmac(value: string, purpose = "default"): string {
  return crypto.createHmac("sha256", getMasterKey()).update(`${purpose}:${value}`).digest("hex");
}
