"use client";

/** Tolerant localStorage helpers for per-target / per-tab filter defaults (private windows may throw). */

export function readStoredFilters(key: string): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function writeStoredFilters(key: string, values: Record<string, string>) {
  try {
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v != null && String(v).trim() !== ""));
    if (Object.keys(clean).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(clean));
  } catch {
    // Storage unavailable — filters still live in the URL.
  }
}

/** Picks `keys` from URL search params into a string record (missing → ""). */
export function pickParams(params: URLSearchParams, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""]));
}

export function hasAnyValue(values: Record<string, string>): boolean {
  return Object.values(values).some((v) => v.trim() !== "");
}

/** Parses a numeric filter string; empty / invalid → undefined. */
export function numOrUndefined(v: string | null | undefined): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Comma/plus separated term count (matches server parseFilterTerms). */
export function termCount(v: string | null | undefined): number {
  if (!v) return 0;
  return v
    .split(/[,+]/)
    .map((t) => t.trim())
    .filter(Boolean).length;
}
