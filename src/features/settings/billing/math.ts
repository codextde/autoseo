/** Small isomorphic helpers for the Billing & Costs page (forecast, month keys, CSV). */

const DAY_MS = 86_400_000;

export function daysInUtcMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Linear forecast to the end of the current UTC month: spend so far ÷ elapsed days × days in month.
 * At least one elapsed day is assumed so the first hours of a month don't explode the projection.
 */
export function forecastMonthEnd(spentSoFar: number, now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const elapsedDays = Math.max(1, (now.getTime() - start) / DAY_MS);
  return (spentSoFar / elapsedDays) * daysInUtcMonth(now);
}

/** "YYYY-MM" keys for the current and previous months, newest first. */
export function monthKeysBack(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * CSV cell: quotes when needed and neutralises spreadsheet formulas (cells starting with
 * = + - @ tab or CR are prefixed with an apostrophe). Numbers are written as-is.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
