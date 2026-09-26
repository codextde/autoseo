/**
 * Email handling for attribution: emails are never stored in clear text. We keep a SHA-256 hash of
 * the normalized address (for merging responses ↔ conversions) and a masked preview for the UI.
 * Pure module (node:crypto only) so it can be unit-tested.
 */
import { createHash } from "node:crypto";

const EMAIL_RE = /^[^\s@]{1,128}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
/** Masked preview format produced by `maskEmail` (also accepted from the snippet). */
const MASK_RE = /^[^\s@*]{0,2}\*{3}@[^\s@*]{0,2}\*{3}\.[a-z0-9-]{2,24}$/i;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function isEmailMask(value: unknown): value is string {
  return typeof value === "string" && MASK_RE.test(value);
}

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

/** "jane.doe@example.com" → "ja***@ex***.com" */
export function maskEmail(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return "***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot + 1) : "";
  const keepLocal = local.length > 3 ? 2 : 1;
  return `${local.slice(0, keepLocal)}***@${host.slice(0, Math.min(2, host.length))}***${tld ? `.${tld}` : ""}`;
}

/**
 * Resolves the stored email fields from any combination of a clear-text email, a pre-computed hash
 * (e.g. from the snippet, which hashes in the browser) and a masked preview.
 */
export function resolveEmail(input: {
  email?: string | null;
  emailHash?: string | null;
  emailMask?: string | null;
}): { emailHash: string | null; emailMask: string | null } {
  if (input.email && isEmail(input.email)) {
    return { emailHash: hashEmail(input.email), emailMask: maskEmail(input.email) };
  }
  if (input.email && isSha256(input.email.toLowerCase())) {
    return { emailHash: input.email.toLowerCase(), emailMask: null };
  }
  const hash = input.emailHash?.toLowerCase();
  if (hash && isSha256(hash)) {
    return { emailHash: hash, emailMask: input.emailMask && isEmailMask(input.emailMask) ? input.emailMask : null };
  }
  return { emailHash: null, emailMask: null };
}

/** Replaces anything that looks like an email in a string with its masked form. */
export function redactEmails(text: string): string {
  return text.replace(/[^\s@"'<>(),;:]{1,128}@[^\s@"'<>(),;:]{1,190}\.[a-z]{2,24}/gi, (m) => maskEmail(m));
}
