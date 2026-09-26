import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Release signing for the agent runtime. An Ed25519 key pair is generated on first use and kept in the
 * data volume (`DATA_DIR/agent-release-key.pem`, 0600). The public key is embedded into the served
 * runtime and installers; installed agents pin it and only accept updates signed with it — tampering
 * with the download (or a server that merely serves files) can't push code to agents.
 */

type KeyPair = { privateKey: crypto.KeyObject; publicKeyB64: string };
let cached: KeyPair | null = null;

function keyFile() {
  return path.join(env.dataDir, "agent-release-key.pem");
}

export function getReleaseKeys(): KeyPair {
  if (cached) return cached;
  const file = keyFile();
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
  } catch {
    fs.mkdirSync(env.dataDir, { recursive: true });
    const pair = crypto.generateKeyPairSync("ed25519");
    const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      // `wx`: never overwrite a key another process created concurrently.
      fs.writeFileSync(file, pem, { mode: 0o600, flag: "wx" });
      privateKey = pair.privateKey;
    } catch {
      privateKey = crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
    }
  }
  const publicKeyB64 = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  cached = { privateKey, publicKeyB64 };
  return cached;
}

export function signRelease(content: Buffer): string {
  return crypto.sign(null, content, getReleaseKeys().privateKey).toString("base64");
}

/** Short fingerprint for display (SHA-256 of the public key, first 16 hex chars). */
export function releaseKeyFingerprint(): string {
  return crypto.createHash("sha256").update(getReleaseKeys().publicKeyB64).digest("hex").slice(0, 16);
}
