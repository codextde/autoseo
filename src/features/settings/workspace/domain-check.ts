/** Client-side mirror of the server's allowed-domain check (the server re-validates). */
export function emailDomainOf(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isEmailLike(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function domainAllowed(email: string, allowedDomains: string[]) {
  const list = allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!list.length) return true;
  const d = emailDomainOf(email);
  return list.some((a) => d === a || d.endsWith(`.${a}`));
}

export function emailProblem(email: string, allowedDomains: string[]): string | null {
  if (!isEmailLike(email)) return `“${email}” is not a valid email address.`;
  if (!domainAllowed(email, allowedDomains)) {
    return `@${emailDomainOf(email)} is not allowed. Only ${allowedDomains.map((d) => `@${d}`).join(", ")} can be invited.`;
  }
  return null;
}
