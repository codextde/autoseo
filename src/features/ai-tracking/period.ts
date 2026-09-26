/** Isomorphic period helpers for the tracker (UTC day strings "YYYY-MM-DD"). */

export type DayRange = { from: string; to: string; days: number };
export type PeriodRange = DayRange & { prev: DayRange; preset: string };

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return dayString(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}

export const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** 7d/30d/90d (ending today) or custom from..to; previous period = same length right before. */
export function resolveRange(preset: string | null | undefined, from?: string | null, to?: string | null, today = dayString(new Date())): PeriodRange {
  let range: DayRange;
  if (preset === "custom" && from && ISO_DAY.test(from)) {
    const end = to && ISO_DAY.test(to) && to >= from ? (to > today ? today : to) : today;
    const start = from > end ? end : from;
    range = { from: start, to: end, days: Math.min(730, daysBetween(start, end)) };
    if (range.days === 730) range.from = addDays(end, -729);
  } else {
    const days = PERIOD_DAYS[preset ?? ""] ?? 30;
    range = { from: addDays(today, -(days - 1)), to: today, days };
  }
  const prevTo = addDays(range.from, -1);
  return { ...range, preset: preset && (PERIOD_DAYS[preset] || preset === "custom") ? preset : "30d", prev: { from: addDays(prevTo, -(range.days - 1)), to: prevTo, days: range.days } };
}

export function eachDay(range: DayRange): string[] {
  const out: string[] = [];
  for (let i = 0; i < range.days; i++) out.push(addDays(range.from, i));
  return out;
}
