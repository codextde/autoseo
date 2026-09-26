/** Local SEO UI helpers: tool metadata, JSON guards for provider rows, coordinate parsing, client cost estimates. */
import type { LocalRunTool } from "@/server/seo/local";
import { estimateLocalRunCost } from "@/server/seo/lib/local";

export const LOCAL_TOOLS: { key: LocalRunTool; label: string; short: string; description: string }[] = [
  { key: "business_search", label: "Business search", short: "Businesses", description: "Find Google Business listings around a location — filter by category, rating, reviews and claimed status." },
  { key: "local_serp", label: "Local SERP", short: "Local SERP", description: "See who ranks in Google Maps or the Local Finder for a keyword at an exact coordinate." },
  { key: "rank_grid", label: "Rank grid", short: "Rank grid", description: "Run one Maps search per grid point around a location to map how far a business's visibility reaches." },
  { key: "business_profile", label: "Business profile", short: "Profile", description: "Read a Google Business Profile: categories, rating breakdown, hours, contact details and claimed status." },
  { key: "reviews", label: "Reviews", short: "Reviews", description: "Collect a business's Google reviews (optionally including other review sites Google shows)." },
  { key: "questions", label: "Questions & answers", short: "Q&A", description: "Read the questions people ask on a Google Business Profile, answered and unanswered." },
  { key: "posts", label: "Posts", short: "Posts", description: "Read the updates (posts) a business publishes on its Google Business Profile." },
];

export function isLocalTool(v: string | null | undefined): v is LocalRunTool {
  return LOCAL_TOOLS.some((t) => t.key === v);
}

export const ACTIVE_STATUSES = new Set(["queued", "running", "processing"]);

/* ───────────────────────────── JSON guards ───────────────────────────── */

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
export const rec = (v: unknown): Rec | null => (isRec(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
export const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

export function ratingOf(row: Rec): { value: number | null; votes: number | null } {
  const r = rec(row.rating);
  return { value: num(r?.value), votes: num(r?.votes_count) };
}

/** Business picked from a result row, reused to prefill other tools. */
export type PickedBusiness = { title: string | null; cid: string | null; placeId: string | null; latitude: number | null; longitude: number | null };

export function pickBusiness(row: Rec): PickedBusiness {
  return {
    title: str(row.title),
    cid: str(row.cid) ?? (num(row.cid) != null ? String(num(row.cid)) : null),
    placeId: str(row.place_id),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
  };
}

/* ───────────────────────────── Coordinates ───────────────────────────── */

export type LatLng = { latitude: number; longitude: number };

function valid(lat: number, lng: number): LatLng | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null;
}

const N = "(-?\\d{1,3}(?:\\.\\d+)?)";

/** "52.52, 13.405", a Google Maps URL (`@lat,lng,15z`, `!3dlat!4dlng`, `?q=lat,lng`) → coordinates. */
export function parseCoordinates(text: string): LatLng | null {
  const t = text.trim();
  if (!t) return null;
  const patterns = [
    new RegExp(`!3d${N}!4d${N}`),
    new RegExp(`@${N},${N}`),
    new RegExp(`[?&](?:q|ll|center|query|destination)=${N},\\s*${N}`),
    new RegExp(`^${N}\\s*[,;\\s]\\s*${N}$`),
  ];
  for (const p of patterns) {
    const m = p.exec(t);
    if (m) {
      const c = valid(Number(m[1]), Number(m[2]));
      if (c) return c;
    }
  }
  return null;
}

export function formatLatLng(c: LatLng | null | undefined): string {
  if (!c) return "—";
  return `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
}

/* ───────────────────────────── Cost estimates (shared with the server) ───────────────────────────── */

export function estimateToolCost(tool: LocalRunTool, input: { depth?: number; gridSize?: number; includeOtherSources?: boolean }): number {
  return estimateLocalRunCost(tool, input);
}

export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (value.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
