import "server-only";
import { eq } from "drizzle-orm";
import { getSetting } from "@/server/settings";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration, readSecret } from "./store";
import { httpJson, IntegrationHttpError } from "./http";

const BING_BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export class BingNotConfiguredError extends Error {
  constructor(message = "Bing Webmaster Tools is not connected. Add your site URL and API key in Integrations.") {
    super(message);
  }
}

export type BingStatRow = {
  date: string; // YYYY-MM-DD
  key: string; // query or page URL
  clicks: number;
  impressions: number;
  position: number | null;
};

export type BingTrafficRow = { date: string; clicks: number; impressions: number };

/** Parses WCF JSON dates like "/Date(1690354800000-0700)/" into YYYY-MM-DD (UTC). */
export function parseBingDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function call<T>(method: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey });
  try {
    const res = await httpJson<{ d?: T; ErrorCode?: number; Message?: string }>(`${BING_BASE}/${method}?${qs}`, {
      timeoutMs: 45_000,
    });
    if (res.ErrorCode) throw new Error(res.Message ?? `Bing Webmaster API error ${res.ErrorCode}`);
    return (res.d ?? ([] as unknown)) as T;
  } catch (err) {
    if (err instanceof IntegrationHttpError) {
      let msg = "";
      try {
        msg = (JSON.parse(err.body) as { Message?: string }).Message ?? "";
      } catch {
        msg = err.body.slice(0, 200);
      }
      if (err.status === 401 || err.status === 403 || /InvalidApiKey|NotAuthorized/i.test(msg))
        throw new Error("Bing rejected the API key (or the key has no access to this site).");
      if (err.status === 400 && /site/i.test(msg)) throw new Error(`Bing: ${msg || "invalid site URL"}`);
      throw new Error(`Bing Webmaster API error (${err.status || "network"})${msg ? `: ${msg}` : ""}`);
    }
    throw err;
  }
}

export async function bingListSites(apiKey: string): Promise<{ url: string; verified: boolean }[]> {
  const rows = await call<{ Url: string; IsVerified?: boolean }[]>("GetUserSites", apiKey);
  return rows.map((r) => ({ url: r.Url, verified: r.IsVerified !== false }));
}

function mapStats(rows: Record<string, unknown>[]): BingStatRow[] {
  const out: BingStatRow[] = [];
  for (const r of rows) {
    const date = parseBingDate(r.Date);
    const key = typeof r.Query === "string" ? r.Query : "";
    if (!date || !key) continue;
    const pos = Number(r.AvgImpressionPosition ?? r.AvgClickPosition ?? NaN);
    out.push({
      date,
      key,
      clicks: Number(r.Clicks ?? 0) || 0,
      impressions: Number(r.Impressions ?? 0) || 0,
      position: Number.isFinite(pos) && pos > 0 ? pos : null,
    });
  }
  return out;
}

export async function bingQueryStats(apiKey: string, siteUrl: string) {
  return mapStats(await call<Record<string, unknown>[]>("GetQueryStats", apiKey, { siteUrl }));
}

export async function bingPageStats(apiKey: string, siteUrl: string) {
  return mapStats(await call<Record<string, unknown>[]>("GetPageStats", apiKey, { siteUrl }));
}

export async function bingTrafficStats(apiKey: string, siteUrl: string): Promise<BingTrafficRow[]> {
  const rows = await call<Record<string, unknown>[]>("GetRankAndTrafficStats", apiKey, { siteUrl });
  const out: BingTrafficRow[] = [];
  for (const r of rows) {
    const date = parseBingDate(r.Date);
    if (!date) continue;
    out.push({ date, clicks: Number(r.Clicks ?? 0) || 0, impressions: Number(r.Impressions ?? 0) || 0 });
  }
  return out;
}

/** Resolves the Bing credentials of a project (per-project key preferred, instance key fallback). */
export async function getBingCredentials(projectId: string): Promise<{ apiKey: string; siteUrl: string; keySource: "project" | "instance" } | null> {
  const row = await getIntegration(projectId, PROVIDERS.bing);
  if (!row) return null;
  const siteUrl = typeof row.config.siteUrl === "string" ? row.config.siteUrl : "";
  const secret = readSecret<{ apiKey?: string }>(row);
  if (secret?.apiKey) return { apiKey: secret.apiKey, siteUrl, keySource: "project" };
  const fallback = (await getSetting("integrations")).bingWebmasterApiKey;
  if (fallback) {
    // The instance key may see many sites of the admin's Bing account — only allow the project's own domain.
    const [project] = await db.select({ domain: projects.domain }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || !bingSiteMatchesDomain(siteUrl, project.domain)) {
      throw new BingNotConfiguredError(
        `The instance-wide Bing API key can only be used for sites on ${project?.domain ?? "the project domain"}. Add your own API key for other sites.`,
      );
    }
    return { apiKey: fallback, siteUrl, keySource: "instance" };
  }
  return null;
}

/** True when the Bing site URL belongs to the project domain (same host or a subdomain). */
export function bingSiteMatchesDomain(siteUrl: string, domain: string): boolean {
  let host = "";
  try {
    host = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const d = domain.toLowerCase().replace(/^www\./, "");
  const h = host.replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** Normalizes a site URL for comparison with Bing's list (trailing slash, lower-case host). */
export function sameBingSite(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      const u = new URL(s);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return s.trim().toLowerCase().replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

/** Verifies an API key + site combination. */
export async function testBingConnection(apiKey: string, siteUrl: string, opts: { revealSites?: boolean } = {}): Promise<string> {
  const sites = await bingListSites(apiKey);
  const match = sites.find((s) => sameBingSite(s.url, siteUrl));
  if (!match) {
    const list = opts.revealSites === false ? "" : sites.slice(0, 5).map((s) => s.url).join(", ");
    throw new Error(`The site is not in this Bing Webmaster account.${list ? ` Available: ${list}` : ""}`);
  }
  if (!match.verified) throw new Error("The site is not verified in Bing Webmaster Tools yet.");
  return opts.revealSites === false
    ? `Connected — ${match.url} verified.`
    : `Connected — ${sites.length} site${sites.length === 1 ? "" : "s"} in the account, ${match.url} verified.`;
}
