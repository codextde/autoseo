import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Deterministic row ids (open-seo parity): derived from stable content so retried/resumed
 * persistence with ON CONFLICT DO NOTHING/UPDATE is idempotent.
 */
export function deterministicAuditRowId(...parts: string[]): string {
  return sha256Hex(parts.join("|")).slice(0, 36);
}
