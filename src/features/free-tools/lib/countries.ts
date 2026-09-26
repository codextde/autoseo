/**
 * Countries offered by the free tools (open-seo `TOOL_COUNTRIES`). Codes are DataForSEO location codes; the client
 * only ever sends a location code — the server derives the language from this list, so an unknown code is rejected.
 */
export const TOOL_COUNTRIES = [
  { code: 2840, iso: "US", label: "United States", language: "en" },
  { code: 2826, iso: "UK", label: "United Kingdom", language: "en" },
  { code: 2124, iso: "CA", label: "Canada", language: "en" },
  { code: 2036, iso: "AU", label: "Australia", language: "en" },
  { code: 2276, iso: "DE", label: "Germany", language: "de" },
  { code: 2250, iso: "FR", label: "France", language: "fr" },
  { code: 2724, iso: "ES", label: "Spain", language: "es" },
  { code: 2356, iso: "IN", label: "India", language: "en" },
  { code: 2528, iso: "NL", label: "Netherlands", language: "nl" },
  { code: 2076, iso: "BR", label: "Brazil", language: "pt" },
] as const;

export const DEFAULT_COUNTRY_CODE = 2840;

export function countryLanguage(code: number): string | null {
  return TOOL_COUNTRIES.find((c) => c.code === code)?.language ?? null;
}

export function countryLabel(code: number): string {
  return TOOL_COUNTRIES.find((c) => c.code === code)?.label ?? "Unknown";
}

/** Project country (ISO, "GB" = "UK") → tool location code, falling back to the US. */
export function toolCountryForIso(iso: string | null | undefined): number {
  const key = (iso ?? "").toUpperCase() === "GB" ? "UK" : (iso ?? "").toUpperCase();
  return TOOL_COUNTRIES.find((c) => c.iso === key)?.code ?? DEFAULT_COUNTRY_CODE;
}
