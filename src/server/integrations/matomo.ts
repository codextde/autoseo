import "server-only";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration, readSecret } from "./store";
import { httpText } from "./http";

export type MatomoCredentials = { url: string; siteId: string; tokenAuth: string };

export class MatomoError extends Error {}

/** Base API endpoint (`…/index.php`) from the configured instance URL. */
export function matomoEndpoint(baseUrl: string): string {
  const u = new URL(baseUrl.trim());
  let p = u.pathname.replace(/\/+$/, "");
  if (p.endsWith("/index.php")) p = p.slice(0, -"/index.php".length);
  u.pathname = `${p}/index.php`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Calls a Matomo Reporting API method. The token is sent in the POST body (never in the URL,
 * so it does not end up in access logs). User-supplied URL → SSRF-protected request.
 */
export async function matomoCall<T = unknown>(
  creds: MatomoCredentials,
  method: string,
  params: Record<string, string | number> = {},
  timeoutMs = 60_000,
): Promise<T> {
  const qs = new URLSearchParams({ module: "API", method, format: "JSON" });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const { text } = await httpText(`${matomoEndpoint(creds.url)}?${qs}`, {
    method: "POST",
    body: new URLSearchParams({ token_auth: creds.tokenAuth }),
    untrusted: true,
    timeoutMs,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MatomoError("Matomo returned an unexpected response — is the URL correct?");
  }
  if (parsed && typeof parsed === "object" && (parsed as { result?: string }).result === "error") {
    const msg = (parsed as { message?: string }).message ?? "Matomo API error";
    throw new MatomoError(msg.replace(/<[^>]+>/g, "").slice(0, 300));
  }
  return parsed as T;
}

export type MatomoSite = { idsite: string | number; name: string; main_url: string; timezone?: string; currency?: string };

export async function matomoGetSite(creds: MatomoCredentials): Promise<MatomoSite> {
  return matomoCall<MatomoSite>(creds, "SitesManager.getSiteFromId", { idSite: creds.siteId }, 20_000);
}

export async function testMatomoConnection(creds: MatomoCredentials): Promise<string> {
  const site = await matomoGetSite(creds);
  if (!site?.name) throw new MatomoError("Site not found or the token has no view access.");
  return `Connected to “${site.name}” (${site.main_url}).`;
}

/** One visit of Live.getLastVisitsDetails (only the fields we use). */
export type MatomoVisit = {
  idVisit?: string | number;
  serverDate?: string;
  firstActionTimestamp?: number;
  referrerType?: string;
  referrerName?: string;
  referrerUrl?: string;
  visitDuration?: number | string;
  actions?: number | string;
  countryCode?: string;
  visitConverted?: number | string;
  goalConversions?: number | string;
  totalEcommerceRevenue?: number | string;
  actionDetails?: { type?: string; url?: string; revenue?: number | string; goalId?: string | number }[];
};

export async function getMatomoCredentials(projectId: string): Promise<MatomoCredentials | null> {
  const row = await getIntegration(projectId, PROVIDERS.matomo);
  if (!row) return null;
  const secret = readSecret<{ tokenAuth?: string }>(row);
  const url = typeof row.config.url === "string" ? row.config.url : "";
  const siteId = row.config.siteId != null ? String(row.config.siteId) : "";
  if (!url || !siteId || !secret?.tokenAuth) return null;
  return { url, siteId, tokenAuth: secret.tokenAuth };
}
