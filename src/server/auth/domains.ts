import "server-only";
import { getSetting } from "@/server/settings";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@")[1] ?? "";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** True when the email's domain is on the allow-list (or no allow-list is configured). */
export async function isEmailDomainAllowed(email: string): Promise<boolean> {
  const { allowedDomains } = await getSetting("auth");
  const list = allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (list.length === 0) return true;
  const domain = emailDomain(email);
  // Exact match or subdomain match (e.g. team.solakon.de for solakon.de)
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}
