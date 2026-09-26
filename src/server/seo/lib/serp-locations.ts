/**
 * Sub-country SERP location registry filtering + ranking (port of open-seo `shared/serp-location-search.ts`
 * and `server/lib/dataforseo/serp-locations.ts`). Pure.
 */
import { formatLocationLabel } from "./locations";

export type SerpLocation = {
  locationCode: number;
  locationName: string;
  locationType: string;
  displayLabel: string;
};

/** Sub-country granularities users target (no postal codes, states, airports …). */
export const INCLUDED_LOCATION_TYPES = new Set(["City", "County", "Municipality", "DMA Region", "Region"]);

export function slimLocationRegistry(
  result: ({ location_code?: number; location_name?: string; location_type?: string | null } | null | undefined)[],
): SerpLocation[] {
  const out: SerpLocation[] = [];
  for (const item of result) {
    if (!item || typeof item.location_code !== "number" || typeof item.location_name !== "string") continue;
    const type = item.location_type ?? "";
    if (!INCLUDED_LOCATION_TYPES.has(type)) continue;
    out.push({
      locationCode: item.location_code,
      locationName: item.location_name,
      locationType: type,
      displayLabel: formatLocationLabel(item.location_name),
    });
  }
  return out;
}

export const REGION_ABBREVIATIONS: Record<string, Record<string, string>> = {
  us: {
    al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut",
    de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
    ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan",
    mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire",
    nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio",
    ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota",
    tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia",
    wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia",
  },
  ca: {
    ab: "Alberta", bc: "British Columbia", mb: "Manitoba", nb: "New Brunswick", nl: "Newfoundland and Labrador",
    ns: "Nova Scotia", nt: "Northwest Territories", nu: "Nunavut", on: "Ontario", pe: "Prince Edward Island",
    qc: "Quebec", sk: "Saskatchewan", yt: "Yukon",
  },
  au: {
    nsw: "New South Wales", vic: "Victoria", qld: "Queensland", sa: "South Australia", tas: "Tasmania",
    act: "Australian Capital Territory",
  },
};

export const LOCATION_TYPE_RANK: Record<string, number> = {
  City: 0,
  Municipality: 1,
  "City Region": 2,
  Borough: 2,
  County: 3,
  State: 4,
  Province: 4,
  Region: 4,
  Country: 5,
  "DMA Region": 6,
  Neighborhood: 7,
  District: 7,
};

/** Lowercase, strip accents, collapse whitespace. */
export function foldLocationText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(query: string, countryCode: string | undefined): string[] {
  const tokens = foldLocationText(query)
    .split(/[\s,]+/)
    .filter(Boolean);
  const abbreviations = REGION_ABBREVIATIONS[countryCode?.toLowerCase() ?? ""];
  if (!abbreviations) return tokens;
  // Never expand the first token ("La Crosse", "De Pere" are place names).
  return tokens.map((t, i) => {
    const region = i > 0 ? abbreviations[t] : undefined;
    return region ? foldLocationText(region) : t;
  });
}

/**
 * Every token must be a substring of the folded name. Score: 0 place == phrase, 1 place == first token,
 * 2 place startsWith first token, 3 other; tie-break by type rank then alphabetical. Top 10.
 */
export function rankSerpLocations<T extends { locationName: string; locationType: string }>(
  query: string,
  locations: readonly T[],
  countryCode?: string,
  limit = 10,
): T[] {
  const tokens = tokenize(query, countryCode);
  if (tokens.length === 0) return [];
  const phrase = tokens.join(" ");
  const head = tokens[0]!;
  const scored: { location: T; score: number; folded: string }[] = [];
  for (const location of locations) {
    const folded = foldLocationText(location.locationName);
    if (!tokens.every((t) => folded.includes(t))) continue;
    const comma = folded.indexOf(",");
    const place = comma < 0 ? folded : folded.slice(0, comma).trim();
    const score = place === phrase ? 0 : place === head ? 1 : place.startsWith(head) ? 2 : 3;
    scored.push({ location, score, folded });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (LOCATION_TYPE_RANK[a.location.locationType] ?? 9) - (LOCATION_TYPE_RANK[b.location.locationType] ?? 9) ||
      (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.location);
}
