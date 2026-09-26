import { format, parseISO } from "date-fns";
import type { DateRangeValue } from "./types";

export const RANGE_PRESETS: { key: string; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "Month to date" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom range" },
];

export type ResolvedPeriod = {
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  label: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function label(from: string, to: string): string {
  try {
    const f = parseISO(from);
    const t = parseISO(to);
    const sameYear = f.getFullYear() === t.getFullYear();
    return `${format(f, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(t, "MMM d, yyyy")}`;
  } catch {
    return `${from} – ${to}`;
  }
}

/** Resolves a report date range into concrete UTC day bounds + the previous period of equal length. */
export function resolveReportPeriod(range: DateRangeValue | null | undefined, now = new Date()): ResolvedPeriod {
  const today = utcDay(now);
  let from: Date;
  let to: Date = today;
  const preset = range?.preset ?? "30d";
  if (preset === "custom" && range?.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from)) {
    from = parseISO(`${range.from}T00:00:00Z`);
    to = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? parseISO(`${range.to}T00:00:00Z`) : today;
    if (to < from) [from, to] = [to, from];
  } else if (preset === "mtd") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else if (preset === "last_month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else {
    const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
    from = addDays(today, -(days - 1));
  }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: iso(from), to: iso(to), days, prevFrom: iso(prevFrom), prevTo: iso(prevTo), label: label(iso(from), iso(to)) };
}

export function rangeLabel(range: DateRangeValue | null | undefined): string {
  if (!range || range.preset !== "custom") return RANGE_PRESETS.find((p) => p.key === (range?.preset ?? "30d"))?.label ?? "Last 30 days";
  return resolveReportPeriod(range).label;
}

/** All ISO days between two ISO dates (inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = parseISO(`${from}T00:00:00Z`);
  const end = parseISO(`${to}T00:00:00Z`).getTime();
  let guard = 0;
  while (d.getTime() <= end && guard++ < 1000) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}
