/**
 * Destination-change detection for integration credentials (pure). Stored secrets are only re-used
 * while every field that decides *where* they are sent stays the same.
 */
const DESTINATION_KEY = /(url|domain|host|site|shop|endpoint|port|server|instance)/i;

/** Fields that decide where credentials are sent (site URL, shop domain, webhook URL, host/port…). */
export function isDestinationField(f: { key: string; type: string }): boolean {
  return f.type === "url" || DESTINATION_KEY.test(f.key);
}

/** Canonical form of a destination (scheme + host + port + path + query, case-insensitive). */
export function normalizeDestination(v: string): string {
  const raw = v.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** True when any destination field in `next` differs from the stored value (blank = unchanged). */
export function destinationChanged(
  fields: Array<{ key: string; type: string }>,
  next: Record<string, string>,
  stored: Record<string, string>,
): boolean {
  return fields.some((f) => {
    if (!isDestinationField(f)) return false;
    const v = (next[f.key] ?? "").trim();
    if (!v) return false;
    return normalizeDestination(v) !== normalizeDestination(stored[f.key] ?? "");
  });
}
