import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getEngine } from "@/lib/engines";

export const engineName = (id: string) => getEngine(id)?.shortName ?? id;

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Runs raw SQL and returns rows (typed loosely — callers coerce). */
export async function rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const res = await db.execute(query);
  return res as unknown as T[];
}

const existsCache = new Map<string, { at: number; value: boolean }>();

/** to_regclass check, cached for a minute. */
export async function tableExists(name: string): Promise<boolean> {
  const hit = existsCache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const [row] = await rows<{ ok: boolean }>(sql`select to_regclass(${`public.${name}`}) is not null as ok`);
  const value = !!row?.ok;
  existsCache.set(name, { at: Date.now(), value });
  return value;
}

/** Scales a raw magnitude into a 1–10 score using soft thresholds. */
export function scale10(value: number, thresholds: [number, number, number, number]): number {
  const [a, b, c, d] = thresholds;
  if (value >= d) return 9;
  if (value >= c) return 8;
  if (value >= b) return 6;
  if (value >= a) return 5;
  return 3;
}

export function clamp10(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export function quote(s: string): string {
  return `“${truncate(s.trim(), 90)}”`;
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]!.toLowerCase();
  }
}

export function isOwnDomain(domain: string, own: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return own.some((o) => d === o || d.endsWith(`.${o}`));
}

/** Drops the internal ranking key from a ranked finding. */
export function withoutRank<T extends { rank: number }>(item: T): Omit<T, "rank"> {
  const copy: Partial<T> = { ...item };
  delete copy.rank;
  return copy as Omit<T, "rank">;
}
