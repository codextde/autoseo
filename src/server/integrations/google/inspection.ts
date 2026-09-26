import "server-only";
import { httpJson, IntegrationHttpError } from "../http";

/**
 * Search Console URL Inspection API
 * (`POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`).
 * The normalization helpers are pure so they can be unit-tested and reused by MCP tools.
 */

export const URL_INSPECTION_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export type InspectionVerdict = "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | "VERDICT_UNSPECIFIED";

export type UrlInspectionResult = {
  verdict: InspectionVerdict;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  lastCrawlTime: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  /** Both canonicals known and different (Google chose another canonical than declared). */
  canonicalMismatch: boolean;
  crawledAs: string | null;
  sitemaps: string[];
  referringUrls: string[];
  mobileUsability: { verdict: InspectionVerdict; issues: { issueType: string; severity: string; message: string }[] } | null;
  richResults: {
    verdict: InspectionVerdict;
    detectedItems: { richResultType: string; items: { name: string; issues: { issueMessage: string; severity: string }[] }[] }[];
  } | null;
  amp: { verdict: InspectionVerdict; indexingState: string | null; ampUrl: string | null } | null;
  inspectionResultLink: string | null;
};

type Raw = Record<string, unknown>;

const VERDICTS: InspectionVerdict[] = ["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"];

function verdictOf(v: unknown): InspectionVerdict {
  return typeof v === "string" && (VERDICTS as string[]).includes(v) ? (v as InspectionVerdict) : "VERDICT_UNSPECIFIED";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

function obj(v: unknown): Raw | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
}

function arr(v: unknown): Raw[] {
  return Array.isArray(v) ? (v.filter((x) => obj(x)) as Raw[]) : [];
}

/** Canonical URLs compare equal when they only differ in a trailing slash or host case. */
export function sameCanonical(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "") || "/"}${x.search}`;
    } catch {
      return u.trim().replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

/** Maps the API response (`{ inspectionResult }` or the inner object) to a stable, typed shape. */
export function normalizeInspection(raw: unknown): UrlInspectionResult {
  const root = obj(raw) ?? {};
  const r = obj(root.inspectionResult) ?? root;
  const idx = obj(r.indexStatusResult) ?? {};
  const mobile = obj(r.mobileUsabilityResult);
  const rich = obj(r.richResultsResult);
  const amp = obj(r.ampResult);
  const googleCanonical = str(idx.googleCanonical);
  const userCanonical = str(idx.userCanonical);
  return {
    verdict: verdictOf(idx.verdict),
    coverageState: str(idx.coverageState),
    robotsTxtState: str(idx.robotsTxtState),
    indexingState: str(idx.indexingState),
    lastCrawlTime: str(idx.lastCrawlTime),
    pageFetchState: str(idx.pageFetchState),
    googleCanonical,
    userCanonical,
    canonicalMismatch: !!googleCanonical && !!userCanonical && !sameCanonical(googleCanonical, userCanonical),
    crawledAs: str(idx.crawledAs),
    sitemaps: strList(idx.sitemap),
    referringUrls: strList(idx.referringUrls),
    mobileUsability: mobile
      ? {
          verdict: verdictOf(mobile.verdict),
          issues: arr(mobile.issues).map((i) => ({
            issueType: str(i.issueType) ?? "ISSUE",
            severity: str(i.severity) ?? "WARNING",
            message: str(i.message) ?? "",
          })),
        }
      : null,
    richResults: rich
      ? {
          verdict: verdictOf(rich.verdict),
          detectedItems: arr(rich.detectedItems).map((d) => ({
            richResultType: str(d.richResultType) ?? "Rich result",
            items: arr(d.items).map((it) => ({
              name: str(it.name) ?? "Unnamed item",
              issues: arr(it.issues).map((x) => ({ issueMessage: str(x.issueMessage) ?? "", severity: str(x.severity) ?? "WARNING" })),
            })),
          })),
        }
      : null,
    amp: amp ? { verdict: verdictOf(amp.verdict), indexingState: str(amp.indexingState), ampUrl: str(amp.ampUrl) } : null,
    inspectionResultLink: str(r.inspectionResultLink),
  };
}

/**
 * Reads a result stored in the inspection history (already normalized). Falls back to
 * `normalizeInspection` for raw API payloads, so older/other shapes still render.
 */
export function readStoredInspection(stored: unknown): UrlInspectionResult {
  const s = obj(stored);
  if (!s || !("sitemaps" in s || "canonicalMismatch" in s || "coverageState" in s) || "inspectionResult" in s || "indexStatusResult" in s) {
    return normalizeInspection(stored);
  }
  const mobile = obj(s.mobileUsability);
  const rich = obj(s.richResults);
  const amp = obj(s.amp);
  const googleCanonical = str(s.googleCanonical);
  const userCanonical = str(s.userCanonical);
  return {
    verdict: verdictOf(s.verdict),
    coverageState: str(s.coverageState),
    robotsTxtState: str(s.robotsTxtState),
    indexingState: str(s.indexingState),
    lastCrawlTime: str(s.lastCrawlTime),
    pageFetchState: str(s.pageFetchState),
    googleCanonical,
    userCanonical,
    canonicalMismatch: !!googleCanonical && !!userCanonical && !sameCanonical(googleCanonical, userCanonical),
    crawledAs: str(s.crawledAs),
    sitemaps: strList(s.sitemaps),
    referringUrls: strList(s.referringUrls),
    mobileUsability: mobile
      ? {
          verdict: verdictOf(mobile.verdict),
          issues: arr(mobile.issues).map((i) => ({ issueType: str(i.issueType) ?? "ISSUE", severity: str(i.severity) ?? "WARNING", message: str(i.message) ?? "" })),
        }
      : null,
    richResults: rich
      ? {
          verdict: verdictOf(rich.verdict),
          detectedItems: arr(rich.detectedItems).map((d) => ({
            richResultType: str(d.richResultType) ?? "Rich result",
            items: arr(d.items).map((it) => ({
              name: str(it.name) ?? "Unnamed item",
              issues: arr(it.issues).map((x) => ({ issueMessage: str(x.issueMessage) ?? "", severity: str(x.severity) ?? "WARNING" })),
            })),
          })),
        }
      : null,
    amp: amp ? { verdict: verdictOf(amp.verdict), indexingState: str(amp.indexingState), ampUrl: str(amp.ampUrl) } : null,
    inspectionResultLink: str(s.inspectionResultLink),
  };
}

export type InspectionApiErrorCode = "quota_exceeded" | "forbidden" | "url_not_in_property" | "reconnect_required" | "upstream_error";

/** Friendly mapping of URL Inspection API errors. */
export function inspectionApiError(err: unknown): { code: InspectionApiErrorCode; message: string } {
  if (err instanceof IntegrationHttpError) {
    let upstream = "";
    try {
      upstream = (JSON.parse(err.body) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      upstream = err.body.slice(0, 200);
    }
    if (err.status === 429)
      return { code: "quota_exceeded", message: "Google's URL Inspection quota for this property is used up (2,000 per day / 600 per minute). Try again later." };
    if (err.status === 401) return { code: "reconnect_required", message: "Google rejected the access token — reconnect the Google account." };
    if (err.status === 403) {
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(err.body))
        return { code: "forbidden", message: "The Search Console API is not enabled for the Google Cloud project of the OAuth client." };
      return { code: "forbidden", message: "The connected Google account has no permission to inspect URLs of this Search Console property." };
    }
    if (err.status === 400 && /belong|not part of|property/i.test(upstream))
      return { code: "url_not_in_property", message: `Google says the URL is not part of this property.${upstream ? ` (${upstream})` : ""}` };
    if (err.status === 400) return { code: "upstream_error", message: `Google rejected the request${upstream ? `: ${upstream}` : "."}` };
    return { code: "upstream_error", message: `URL Inspection API error (${err.status || "network"})${upstream ? `: ${upstream}` : `: ${err.message}`}` };
  }
  return { code: "upstream_error", message: err instanceof Error ? err.message : String(err) };
}

/** Calls the URL Inspection API. Throws `IntegrationHttpError` on HTTP errors (map with `inspectionApiError`). */
export async function inspectUrlRaw(
  accessToken: string,
  input: { siteUrl: string; inspectionUrl: string; languageCode?: string | null },
): Promise<UrlInspectionResult> {
  const body: Record<string, string> = { inspectionUrl: input.inspectionUrl, siteUrl: input.siteUrl };
  if (input.languageCode) body.languageCode = input.languageCode;
  const res = await httpJson<unknown>(URL_INSPECTION_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
    timeoutMs: 45_000,
  });
  return normalizeInspection(res);
}
