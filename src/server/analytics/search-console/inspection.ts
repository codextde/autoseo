import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { gscInspections, users } from "@/server/db/schema";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { rateLimit } from "@/server/rate-limit";
import { getIntegration } from "@/server/integrations/store";
import {
  getGoogleAccessToken,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
  GoogleScopeMissingError,
} from "@/server/integrations/google/oauth";
import { inspectionApiError, inspectUrlRaw, readStoredInspection, type UrlInspectionResult } from "@/server/integrations/google/inspection";

/** Google's URL Inspection limits per Search Console property. */
export const INSPECTION_DAILY_LIMIT = 2000;
export const INSPECTION_PER_MINUTE_LIMIT = 600;
/** Results younger than this are served from the history instead of calling Google again. */
export const INSPECTION_CACHE_MS = 24 * 60 * 60 * 1000;

export type InspectionErrorCode =
  | "not_connected"
  | "reconnect_required"
  | "url_not_in_property"
  | "invalid_url"
  | "quota_exceeded"
  | "rate_limited"
  | "upstream_error";

export class InspectionError extends Error {
  constructor(
    public code: InspectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InspectionError";
  }
}

export type InspectionQuota = { used: number; limit: number; remaining: number };

export type InspectUrlResult = {
  /** Id of the stored inspection (history row). */
  id: string;
  url: string;
  siteUrl: string;
  /** true when served from the last 24 h without calling Google. */
  cached: boolean;
  inspectedAt: string;
  result: UrlInspectionResult;
  quota: InspectionQuota;
};

/* ───────────────────────────── Pure helpers ───────────────────────────── */

/** Validates and normalizes a URL for inspection (http(s), no fragment). Throws `InspectionError("invalid_url")`. */
export function normalizeInspectUrl(input: string): string {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new InspectionError("invalid_url", "Enter a full URL including https://.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new InspectionError("invalid_url", "Only http(s) URLs can be inspected.");
  if (raw.length > 2048) throw new InspectionError("invalid_url", "The URL is too long.");
  u.hash = "";
  return u.toString();
}

/**
 * Whether a URL belongs to a Search Console property: URL-prefix properties must be a prefix of the
 * URL; `sc-domain:example.com` covers the domain and all subdomains on any protocol.
 */
export function urlBelongsToProperty(url: string, siteUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (siteUrl.startsWith("sc-domain:")) {
    const domain = siteUrl.slice("sc-domain:".length).trim().toLowerCase().replace(/\.$/, "");
    const host = u.hostname.toLowerCase();
    return !!domain && (host === domain || host.endsWith(`.${domain}`));
  }
  try {
    const p = new URL(siteUrl);
    if (u.protocol !== p.protocol || u.host.toLowerCase() !== p.host.toLowerCase()) return false;
    const prefix = p.pathname.endsWith("/") ? p.pathname : `${p.pathname}/`;
    return u.pathname === p.pathname || u.pathname.startsWith(prefix) || p.pathname === "/";
  } catch {
    return url.startsWith(siteUrl);
  }
}

/** Start of the current UTC day (quota window). */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/* ───────────────────────────── Service ───────────────────────────── */

async function resolveProperty(projectId: string): Promise<string> {
  const row = await getIntegration(projectId, PROVIDERS.gsc);
  const siteUrl = typeof row?.config.siteUrl === "string" ? row.config.siteUrl : "";
  if (!row || row.status === "pending" || !siteUrl) {
    throw new InspectionError("not_connected", "Connect Google Search Console and choose a property to inspect URLs.");
  }
  if (row.config.demo === true) {
    throw new InspectionError("not_connected", "URL inspection needs a live Search Console connection — demo data can't be inspected.");
  }
  return siteUrl;
}

/** Live API calls for a property since UTC midnight (all projects sharing the property). */
async function quotaFor(siteUrl: string): Promise<InspectionQuota> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gscInspections)
    .where(and(eq(gscInspections.siteUrl, siteUrl), eq(gscInspections.apiCall, true), gte(gscInspections.createdAt, utcDayStart())));
  const used = Number(row?.n ?? 0);
  return { used, limit: INSPECTION_DAILY_LIMIT, remaining: Math.max(0, INSPECTION_DAILY_LIMIT - used) };
}

export async function getInspectionQuota(projectId: string): Promise<InspectionQuota | null> {
  const row = await getIntegration(projectId, PROVIDERS.gsc);
  const siteUrl = typeof row?.config.siteUrl === "string" ? row.config.siteUrl : "";
  return siteUrl ? quotaFor(siteUrl) : null;
}

/** Newest successful inspection of the URL within the cache window (null when none). */
export async function getCachedInspection(projectId: string, url: string, maxAgeMs = INSPECTION_CACHE_MS): Promise<InspectUrlResult | null> {
  const siteUrl = await resolveProperty(projectId);
  const normalized = normalizeInspectUrl(url);
  const [row] = await db
    .select()
    .from(gscInspections)
    .where(
      and(
        eq(gscInspections.projectId, projectId),
        eq(gscInspections.siteUrl, siteUrl),
        eq(gscInspections.url, normalized),
        isNull(gscInspections.error),
        gte(gscInspections.createdAt, new Date(Date.now() - maxAgeMs)),
      ),
    )
    .orderBy(desc(gscInspections.createdAt))
    .limit(1);
  if (!row?.result) return null;
  return {
    id: row.id,
    url: row.url,
    siteUrl,
    cached: true,
    inspectedAt: row.createdAt.toISOString(),
    result: readStoredInspection(row.result),
    quota: await quotaFor(siteUrl),
  };
}

/**
 * Inspects a URL of the project's Search Console property (URL Inspection API). Results are cached
 * for 24 h (unless `force`), stored in the inspection history and limited to Google's quota
 * (2,000 per property per UTC day, 600 per minute). Throws `InspectionError`.
 *
 * Pure server function (no permission checks) — callers (actions, MCP) must authorize first.
 */
export async function inspectUrl(input: {
  projectId: string;
  url: string;
  force?: boolean;
  languageCode?: string | null;
  userId?: string | null;
}): Promise<InspectUrlResult> {
  const siteUrl = await resolveProperty(input.projectId);
  const url = normalizeInspectUrl(input.url);
  if (!urlBelongsToProperty(url, siteUrl)) {
    throw new InspectionError(
      "url_not_in_property",
      `${url} is not part of the Search Console property ${siteUrl.replace(/^sc-domain:/, "")}.`,
    );
  }
  if (!input.force) {
    const cached = await getCachedInspection(input.projectId, url);
    if (cached) return cached;
  }

  const quota = await quotaFor(siteUrl);
  if (quota.remaining <= 0) {
    throw new InspectionError(
      "quota_exceeded",
      `The daily URL Inspection quota of ${INSPECTION_DAILY_LIMIT.toLocaleString("en-US")} requests for this property is used up. It resets at midnight UTC.`,
    );
  }
  if (!rateLimit(`gsc-inspect:${siteUrl}`, INSPECTION_PER_MINUTE_LIMIT, 60_000)) {
    throw new InspectionError("rate_limited", `Too many inspections — Google allows ${INSPECTION_PER_MINUTE_LIMIT} per minute per property. Try again in a minute.`);
  }

  let token: string;
  try {
    token = await getGoogleAccessToken(input.projectId, "gsc");
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) throw new InspectionError("not_connected", err.message);
    if (err instanceof GoogleReconnectRequiredError || err instanceof GoogleScopeMissingError || err instanceof GoogleNotConfiguredError)
      throw new InspectionError("reconnect_required", err.message);
    throw err;
  }

  try {
    const result = await inspectUrlRaw(token, { siteUrl, inspectionUrl: url, languageCode: input.languageCode ?? null });
    const [row] = await db
      .insert(gscInspections)
      .values({
        projectId: input.projectId,
        siteUrl,
        url,
        verdict: result.verdict,
        coverageState: result.coverageState,
        result: result as unknown as Record<string, unknown>,
        apiCall: true,
        inspectedBy: input.userId ?? null,
      })
      .returning({ id: gscInspections.id, createdAt: gscInspections.createdAt });
    return {
      id: row!.id,
      url,
      siteUrl,
      cached: false,
      inspectedAt: row!.createdAt.toISOString(),
      result,
      quota: { ...quota, used: quota.used + 1, remaining: Math.max(0, quota.remaining - 1) },
    };
  } catch (err) {
    const mapped = inspectionApiError(err);
    await db.insert(gscInspections).values({
      projectId: input.projectId,
      siteUrl,
      url,
      error: mapped.message.slice(0, 1000),
      apiCall: true,
      inspectedBy: input.userId ?? null,
    });
    // "forbidden" (no permission on the property) is fixed by reconnecting with an account that has access.
    const code: InspectionErrorCode = mapped.code === "forbidden" ? "reconnect_required" : mapped.code;
    throw new InspectionError(code, mapped.message);
  }
}

export type InspectionHistoryItem = {
  id: string;
  url: string;
  verdict: string | null;
  coverageState: string | null;
  error: string | null;
  inspectedAt: string;
  inspectedBy: { name: string | null; email: string } | null;
  result: UrlInspectionResult | null;
};

/** Recent inspections of the project (newest first), incl. failed attempts. */
export async function listRecentInspections(projectId: string, limit = 25): Promise<InspectionHistoryItem[]> {
  const rows = await db
    .select({ i: gscInspections, name: users.name, email: users.email })
    .from(gscInspections)
    .leftJoin(users, eq(users.id, gscInspections.inspectedBy))
    .where(eq(gscInspections.projectId, projectId))
    .orderBy(desc(gscInspections.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));
  return rows.map(({ i, name, email }) => ({
    id: i.id,
    url: i.url,
    verdict: i.verdict,
    coverageState: i.coverageState,
    error: i.error,
    inspectedAt: i.createdAt.toISOString(),
    inspectedBy: email ? { name, email } : null,
    result: i.result ? readStoredInspection(i.result) : null,
  }));
}
