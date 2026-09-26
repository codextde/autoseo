import "server-only";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration, readSecret } from "./store";
import { httpJson, IntegrationHttpError } from "./http";
import { sha256 } from "@/server/crypto";

export type PiwikCredentials = { accountUrl: string; websiteId: string; clientId: string; clientSecret: string };

export class PiwikError extends Error {}

/** Normalizes the account URL to its origin (https://<account>.piwik.pro). */
export function piwikOrigin(accountUrl: string): string {
  const u = new URL(accountUrl.trim());
  return `${u.protocol}//${u.host}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** OAuth client-credentials token (cached until shortly before expiry). */
export async function piwikAccessToken(creds: PiwikCredentials): Promise<string> {
  // The secret is part of the key: a changed/wrong secret must never reuse another token.
  const key = `${piwikOrigin(creds.accountUrl)}|${creds.clientId}|${sha256(creds.clientSecret)}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  try {
    const res = await httpJson<{ access_token?: string; expires_in?: number }>(`${piwikOrigin(creds.accountUrl)}/auth/token`, {
      method: "POST",
      body: { grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret },
      untrusted: true,
      timeoutMs: 20_000,
    });
    if (!res.access_token) throw new PiwikError("Piwik PRO did not return an access token.");
    tokenCache.set(key, { token: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 1800) * 1000 });
    return res.access_token;
  } catch (err) {
    if (err instanceof IntegrationHttpError && (err.status === 400 || err.status === 401))
      throw new PiwikError("Piwik PRO rejected the client ID / secret.");
    throw err;
  }
}

export type PiwikColumn = { column_id: string; transformation_id?: string; goal_id?: number };
export type PiwikCondition = { column_id: string; transformation_id?: string; condition: { operator: string; value: unknown } };
export type PiwikFilter = { operator: "and" | "or"; conditions: (PiwikCondition | PiwikFilter)[] };

export type PiwikQuery = {
  columns: PiwikColumn[];
  date_from: string;
  date_to: string;
  filters?: PiwikFilter;
  metric_filters?: PiwikFilter;
  limit?: number;
  offset?: number;
  order_by?: [number, "asc" | "desc"][];
};

/** Raw value of a Piwik cell: enums come back as [id, label]. */
export type PiwikCell = string | number | null | [string | number, string];

export async function piwikQuery(creds: PiwikCredentials, query: PiwikQuery): Promise<{ columns: string[]; rows: PiwikCell[][]; count: number }> {
  const token = await piwikAccessToken(creds);
  try {
    const res = await httpJson<{ data?: PiwikCell[][]; meta?: { columns?: string[]; count?: number } }>(
      `${piwikOrigin(creds.accountUrl)}/api/analytics/v1/query/`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: { website_id: creds.websiteId, format: "json", ...query, limit: query.limit ?? 10_000, offset: query.offset ?? 0 },
        untrusted: true,
        timeoutMs: 90_000,
      },
    );
    return { columns: res.meta?.columns ?? [], rows: res.data ?? [], count: res.meta?.count ?? res.data?.length ?? 0 };
  } catch (err) {
    if (err instanceof IntegrationHttpError) {
      if (err.status === 401 || err.status === 403) {
        tokenCache.delete(`${piwikOrigin(creds.accountUrl)}|${creds.clientId}|${sha256(creds.clientSecret)}`);
      }
      let detail = "";
      try {
        const parsed = JSON.parse(err.body) as { errors?: { title?: string; detail?: string }[] };
        detail = parsed.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join("; ") ?? "";
      } catch {
        detail = err.body.slice(0, 200);
      }
      if (err.status === 403) throw new PiwikError("The API client has no access to this site/app.");
      if (err.status === 404) throw new PiwikError("Site/app not found in Piwik PRO.");
      throw new PiwikError(`Piwik PRO query failed (${err.status})${detail ? `: ${detail}` : ""}`);
    }
    throw err;
  }
}

/** Label of a cell ([id, label] → label). */
export function piwikCellLabel(cell: PiwikCell | undefined): string {
  if (Array.isArray(cell)) return String(cell[1] ?? cell[0] ?? "");
  return cell == null ? "" : String(cell);
}

/** Id of a cell ([id, label] → id). */
export function piwikCellId(cell: PiwikCell | undefined): string {
  if (Array.isArray(cell)) return String(cell[0] ?? "");
  return cell == null ? "" : String(cell);
}

export async function testPiwikConnection(creds: PiwikCredentials): Promise<string> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const res = await piwikQuery(creds, { columns: [{ column_id: "sessions" }], date_from: from, date_to: to, limit: 1 });
  const sessions = Number(res.rows[0]?.[0] ?? 0) || 0;
  return `Connected — ${sessions.toLocaleString("en-US")} sessions in the last 7 days.`;
}

export async function getPiwikCredentials(projectId: string): Promise<PiwikCredentials | null> {
  const row = await getIntegration(projectId, PROVIDERS.piwik);
  if (!row) return null;
  const secret = readSecret<{ clientSecret?: string }>(row);
  const accountUrl = typeof row.config.accountUrl === "string" ? row.config.accountUrl : "";
  const websiteId = typeof row.config.websiteId === "string" ? row.config.websiteId : "";
  const clientId = typeof row.config.clientId === "string" ? row.config.clientId : "";
  if (!accountUrl || !websiteId || !clientId || !secret?.clientSecret) return null;
  return { accountUrl, websiteId, clientId, clientSecret: secret.clientSecret };
}
