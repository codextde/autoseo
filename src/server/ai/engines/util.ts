import type { AnswerCitation, ShoppingItem, AdItem } from "./types";
import { getCountry } from "@/lib/countries";

/** DataForSEO/our markets use "UK"; ISO 3166 (and most APIs) use "GB". */
export function isoCountry(country: string): string {
  const c = country.toUpperCase();
  return c === "UK" ? "GB" : c;
}

export function countryName(country: string): string {
  return getCountry(country)?.name ?? country;
}

export function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Collects citations in order, deduped by URL, http(s) only, max 60. */
export class CitationCollector {
  private seen = new Set<string>();
  readonly list: AnswerCitation[] = [];
  add(url: unknown, title?: unknown) {
    const u = str(url);
    if (!u || !/^https?:\/\//i.test(u) || u.length > 2048) return;
    const key = u.replace(/#.*$/, "");
    if (this.seen.has(key) || this.list.length >= 60) return;
    this.seen.add(key);
    this.list.push({ url: key, title: str(title), position: this.list.length + 1 });
  }
}

export function uniqueStrings(list: unknown[], max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const s = str(v);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}

export function cleanShopping(items: ShoppingItem[]): ShoppingItem[] {
  return items.filter((i) => i.name.trim()).slice(0, 40);
}

export function cleanAds(items: AdItem[]): AdItem[] {
  return items.filter((a) => a.headline.trim() && a.advertiser.trim()).slice(0, 20);
}

/** Replaces inline citation markers like [1] / 【1】 that some engines leave in the text. */
export function stripCitationMarkers(text: string): string {
  return text.replace(/【\d+(?:†[^】]*)?】/g, "").replace(/\s+\n/g, "\n");
}

/** Keeps raw provider payloads small enough for the DB. */
export function trimRaw(value: unknown, maxChars = 60_000): Record<string, unknown> {
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return obj(JSON.parse(json));
    return { truncated: true, preview: json.slice(0, maxChars) };
  } catch {
    return {};
  }
}
