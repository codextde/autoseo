/**
 * Period helpers shared by the analytics pages (pure — safe for server components, services and tests).
 * URL contract: `?period=7d|30d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.
 */

export type AnalyticsPeriod = {
  preset: string;
  /** Inclusive start date (YYYY-MM-DD) */
  from: string;
  /** Inclusive end date (YYYY-MM-DD) */
  to: string;
  days: number;
  /** Previous period of equal length immediately before `from`. */
  prevFrom: string;
  prevTo: string;
  label: string;
};

const PRESET_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365, "16m": 486 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Real calendar date in YYYY-MM-DD form (rejects 2026-13-40, 2026-02-30…). */
export function isValidDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** Every date from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 2000; d = addDays(d, 1)) out.push(d);
  return out;
}

function fmtLabel(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  return `${f.toLocaleDateString("en-US", sameYear ? opts : { ...opts, year: "numeric" })} – ${t.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

/**
 * Resolves the period from search params. `lagDays` shifts the default end date back (Search
 * Console data trails by ~2–3 days; GA4's last complete day is yesterday).
 */
export function resolveAnalyticsPeriod(
  sp: { period?: string | string[]; from?: string | string[]; to?: string | string[] },
  opts: { defaultPreset?: string; lagDays?: number; today?: Date } = {},
): AnalyticsPeriod {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const preset = one(sp.period) ?? opts.defaultPreset ?? "30d";
  const today = isoDate(opts.today ?? new Date());
  const latest = addDays(today, -(opts.lagDays ?? 1));
  const fromParam = one(sp.from);
  const toParam = one(sp.to);
  let from: string;
  let to: string;
  if (preset === "custom" && fromParam && isValidDate(fromParam)) {
    from = fromParam;
    to = toParam && isValidDate(toParam) ? toParam : latest;
    if (from > to) [from, to] = [to, from];
    // Clamp after the swap: never in the future, at most 16 months of history.
    const floor = addDays(today, -486);
    if (to > today) to = today;
    if (from > to) from = to;
    if (from < floor) from = floor;
    if (to < floor) to = floor;
  } else {
    const days = PRESET_DAYS[preset] ?? 30;
    to = latest;
    from = addDays(to, -(days - 1));
  }
  const days = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const resolvedPreset = preset === "custom" ? (fromParam && isValidDate(fromParam) ? "custom" : "30d") : PRESET_DAYS[preset] ? preset : "30d";
  return { preset: resolvedPreset, from, to, days, prevFrom, prevTo, label: fmtLabel(from, to) };
}

/** Percentage change (null when the previous value is 0 / missing). */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** First day of the month for monthly bucketing. */
export function monthKey(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
