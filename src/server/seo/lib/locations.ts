/**
 * Markets, languages and keyword-data provider routing (port of open-seo `shared/keyword-locations.ts`).
 * Pure + isomorphic (no server-only) so the UI pickers and unit tests can use it.
 * Country data comes from `src/lib/countries.ts` (143 markets incl. googleAdsOnly flags).
 */
import { COUNTRIES, getCountry, getCountryByLocationCode, type Country } from "../../../lib/countries";

export const DEFAULT_LOCATION_CODE = 2840;

/** Master DataForSEO SERP language list (128 entries, `iw`/`no` dropped). Any language works in any country for SERP. */
export const SERP_LANGUAGE_OPTIONS = [
  { code: "af", label: "Afrikaans" },
  { code: "ak", label: "Akan" },
  { code: "sq", label: "Albanian" },
  { code: "am", label: "Amharic" },
  { code: "ar", label: "Arabic" },
  { code: "hy", label: "Armenian" },
  { code: "az", label: "Azerbaijani" },
  { code: "ban", label: "Balinese" },
  { code: "eu", label: "Basque" },
  { code: "be", label: "Belarusian" },
  { code: "bn", label: "Bengali" },
  { code: "bs", label: "Bosnian" },
  { code: "bg", label: "Bulgarian" },
  { code: "my", label: "Burmese" },
  { code: "ca", label: "Catalan" },
  { code: "ceb", label: "Cebuano" },
  { code: "ny", label: "Chichewa" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "hr", label: "Croatian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "et", label: "Estonian" },
  { code: "ee", label: "Ewe" },
  { code: "fo", label: "Faroese" },
  { code: "fa", label: "Farsi" },
  { code: "fil", label: "Filipino" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "fy", label: "Frisian" },
  { code: "gaa", label: "Ga" },
  { code: "gl", label: "Galician" },
  { code: "lg", label: "Ganda" },
  { code: "ka", label: "Georgian" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "gu", label: "Gujarati" },
  { code: "ht", label: "Haitian" },
  { code: "ha", label: "Hausa" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "is", label: "Icelandic" },
  { code: "bem", label: "IciBemba" },
  { code: "ig", label: "Igbo" },
  { code: "id", label: "Indonesian" },
  { code: "ga", label: "Irish" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "kn", label: "Kannada" },
  { code: "kk", label: "Kazakh" },
  { code: "km", label: "Khmer" },
  { code: "rw", label: "Kinyarwanda" },
  { code: "rn", label: "Kirundi" },
  { code: "kg", label: "Kongo" },
  { code: "ko", label: "Korean" },
  { code: "mfe", label: "Kreol morisien" },
  { code: "crs", label: "Kreol Seselwa" },
  { code: "kri", label: "Krio" },
  { code: "ckb", label: "Kurdish" },
  { code: "ky", label: "Kyrgyz" },
  { code: "lo", label: "Lao" },
  { code: "lv", label: "Latvian" },
  { code: "ln", label: "Lingala" },
  { code: "lt", label: "Lithuanian" },
  { code: "ach", label: "Luo" },
  { code: "mk", label: "Macedonian" },
  { code: "mg", label: "Malagasy" },
  { code: "ms", label: "Malay" },
  { code: "ml", label: "Malayalam" },
  { code: "mt", label: "Maltese" },
  { code: "mi", label: "Maori" },
  { code: "mr", label: "Marathi" },
  { code: "mn", label: "Mongolian" },
  { code: "ne", label: "Nepali" },
  { code: "nso", label: "Northern Sotho" },
  { code: "nb", label: "Norwegian (Bokmål)" },
  { code: "nyn", label: "Nyankole" },
  { code: "om", label: "Oromo" },
  { code: "ps", label: "Pashto" },
  { code: "pcm", label: "Pidgin" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "pa", label: "Punjabi" },
  { code: "qu", label: "Quechua" },
  { code: "ro", label: "Romanian" },
  { code: "rm", label: "Romansh" },
  { code: "ru", label: "Russian" },
  { code: "sr", label: "Serbian" },
  { code: "sr-Latn", label: "Serbian (Latin)" },
  { code: "sr-ME", label: "Serbian (Montenegro)" },
  { code: "st", label: "Sesotho" },
  { code: "sn", label: "Shona" },
  { code: "loz", label: "Silozi" },
  { code: "sd", label: "Sindhi" },
  { code: "si", label: "Sinhalese" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "so", label: "Somali" },
  { code: "es", label: "Spanish" },
  { code: "es-419", label: "Spanish (Latin America)" },
  { code: "sw", label: "Swahili" },
  { code: "sv", label: "Swedish" },
  { code: "tl", label: "Tagalog" },
  { code: "tg", label: "Tajik" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "th", label: "Thai" },
  { code: "ti", label: "Tigrinya" },
  { code: "to", label: "Tonga (Tonga Islands)" },
  { code: "lua", label: "Tshiluba" },
  { code: "tn", label: "Tswana" },
  { code: "tum", label: "Tumbuka" },
  { code: "tr", label: "Turkish" },
  { code: "tk", label: "Turkmen" },
  { code: "uk", label: "Ukrainian" },
  { code: "ur", label: "Urdu" },
  { code: "uz", label: "Uzbek" },
  { code: "vi", label: "Vietnamese" },
  { code: "cy", label: "Welsh" },
  { code: "wo", label: "Wolof" },
  { code: "xh", label: "Xhosa" },
  { code: "yo", label: "Yoruba" },
  { code: "zu", label: "Zulu" },
] as const;

const SUPPORTED_LANGUAGE_CODES = new Set<string>(SERP_LANGUAGE_OPTIONS.map((l) => l.code));
const LANGUAGE_LABELS = new Map<string, string>(SERP_LANGUAGE_OPTIONS.map((l) => [l.code, l.label]));

export type LocationOption = {
  code: number;
  label: string;
  /** ISO-2 display label ("UK" for the United Kingdom, like DataForSEO). */
  shortLabel: string;
  languageCode: string;
  googleAdsOnly: boolean;
};

export const LOCATION_OPTIONS: LocationOption[] = COUNTRIES.map((c) => ({
  code: c.locationCode,
  label: c.name,
  shortLabel: c.iso,
  languageCode: c.language,
  googleAdsOnly: c.googleAdsOnly,
}));

/** Countries usable by DataForSEO Labs features (domain overview, ranked keywords …). */
export const LABS_LOCATION_OPTIONS = LOCATION_OPTIONS.filter((o) => !o.googleAdsOnly);

const LOCATION_CODES = new Set(LOCATION_OPTIONS.map((o) => o.code));
const LABS_LOCATION_CODES = new Set(LABS_LOCATION_OPTIONS.map((o) => o.code));

export function isSupportedLocationCode(code: number): boolean {
  return LOCATION_CODES.has(code);
}

export function isLabsLocationCode(code: number): boolean {
  return LABS_LOCATION_CODES.has(code);
}

export type KeywordDataProvider = "labs" | "google_ads";

/** Known code & not Labs → google_ads; unknown codes fall through to Labs. */
export function getKeywordDataProvider(locationCode: number): KeywordDataProvider {
  return LOCATION_CODES.has(locationCode) && !LABS_LOCATION_CODES.has(locationCode) ? "google_ads" : "labs";
}

export function getLocationOption(code: number | null | undefined): LocationOption | undefined {
  if (code == null) return undefined;
  const c = getCountryByLocationCode(code);
  return c
    ? { code: c.locationCode, label: c.name, shortLabel: c.iso, languageCode: c.language, googleAdsOnly: c.googleAdsOnly }
    : undefined;
}

export function locationLabel(code: number | null | undefined): string {
  return getLocationOption(code)?.label ?? (code != null ? String(code) : "—");
}

/** Default language of a country (en when unknown). */
export function getLanguageCode(locationCode: number): string {
  return getCountryByLocationCode(locationCode)?.language ?? "en";
}

export function languageLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return LANGUAGE_LABELS.get(code) ?? code;
}

export function isSupportedLanguageCode(code: string): boolean {
  return SUPPORTED_LANGUAGE_CODES.has(code);
}

/** Languages DataForSEO keyword data serves for a country (multi-language countries list several). */
export function getLanguageOptions(locationCode: number): { code: string; label: string }[] {
  const country = getCountryByLocationCode(locationCode);
  const codes = new Set(country?.languages?.length ? country.languages : [getLanguageCode(locationCode)]);
  return SERP_LANGUAGE_OPTIONS.filter((l) => codes.has(l.code));
}

/** Only Labs locations have authoritative per-country language lists. */
export function isLanguageServedForLocation(locationCode: number, languageCode: string): boolean {
  if (getKeywordDataProvider(locationCode) !== "labs") return true;
  return getLanguageOptions(locationCode).some((o) => o.code === languageCode);
}

/** Keyword-data APIs only serve a country's own languages; fall back to the country default. */
export function resolveKeywordDataLanguage(locationCode: number, languageCode: string): string {
  return getLanguageOptions(locationCode).some((o) => o.code === languageCode) ? languageCode : getLanguageCode(locationCode);
}

export type Market = { locationCode: number; languageCode: string };

/**
 * Resolves a request market against the project default. Overriding only the location snaps the language
 * to that location's default language.
 */
export function resolveMarket(args: { locationCode?: number; languageCode?: string }, project: Market): Market {
  const locationCode = args.locationCode ?? project.locationCode;
  const languageCode =
    args.languageCode ?? (locationCode === project.locationCode ? project.languageCode : getLanguageCode(locationCode));
  return { locationCode, languageCode };
}

/** Same as resolveMarket, but a project market Labs can't serve is replaced by US/en. */
export function resolveLabsMarket(args: { locationCode?: number; languageCode?: string }, project: Market): Market {
  const served =
    getKeywordDataProvider(project.locationCode) === "labs" && isLanguageServedForLocation(project.locationCode, project.languageCode);
  return resolveMarket(args, served ? project : { locationCode: DEFAULT_LOCATION_CODE, languageCode: "en" });
}

/** Project (ISO country + language) → DataForSEO market. */
export function projectMarket(project: { country: string; language: string }): Market {
  const c: Country | undefined = getCountry(project.country);
  if (!c) return { locationCode: DEFAULT_LOCATION_CODE, languageCode: "en" };
  const languageCode = c.languages.includes(project.language) ? project.language : c.language;
  return { locationCode: c.locationCode, languageCode };
}

/** Lowercase ISO 3166-1 alpha-2 code for DataForSEO per-country endpoints (UK → gb). */
export function getIsoCountryCode(locationCode: number): string {
  const iso = getCountryByLocationCode(locationCode)?.iso ?? "US";
  return (iso === "UK" ? "GB" : iso).toLowerCase();
}

/** "Portland-Auburn, ME,United States" → "Portland-Auburn, ME, United States"; maxSegments truncates. */
export function formatLocationLabel(locationName: string, maxSegments?: number): string {
  const parts = locationName.split(",").map((p) => p.trim());
  return (maxSegments ? parts.slice(0, maxSegments) : parts).join(", ");
}

export class SeoValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
}

export function assertLabsLocationCode(locationCode: number): void {
  if (getKeywordDataProvider(locationCode) !== "labs") {
    throw new SeoValidationError(
      `Domain analytics is not available for ${locationLabel(locationCode)} — DataForSEO Labs doesn't cover this country. Pick another market.`,
    );
  }
}

export function assertLanguageForLocation(locationCode: number, languageCode: string): void {
  if (!isLanguageServedForLocation(locationCode, languageCode)) {
    const available = getLanguageOptions(locationCode)
      .map((o) => o.code)
      .join(", ");
    throw new SeoValidationError(`Language '${languageCode}' is not available for this location. Available: ${available}`);
  }
}
