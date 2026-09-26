import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations } from "@/server/db/schema";
import { randomToken } from "@/server/crypto";
import {
  findIntegrationByToken,
  getIntegration,
  issueIngestToken,
  listIntegrations,
  markIntegrationSync,
  readSecret,
  revokeIngestToken,
  saveIntegration,
  type IntegrationRow,
} from "@/server/integrations";
import { getProvider, PROVIDERS } from "./providers";

/**
 * Attribution provider connections live in the core `integrations` table (provider = catalog key from
 * src/lib/integrations-catalog.ts), so the global Integrations page shows them as installed.
 * Non-secret attribution state (event counters, import cursor, provider config) is kept in `config`;
 * secrets (signing secrets, API tokens) are encrypted in `secret`; inbound webhook tokens are hashed.
 */

export const ATTRIBUTION_PROVIDER_KEYS = PROVIDERS.map((p) => p.key);
export type SourceRow = IntegrationRow;

/** Client-safe view of a connected source (never includes secrets). */
export type SourceDTO = {
  id: string;
  provider: string;
  status: IntegrationRow["status"];
  config: Record<string, string>;
  secretKeys: string[];
  tokenPrefix: string | null;
  eventCount: number;
  lastEventAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
};

function configStrings(row: IntegrationRow): Record<string, string> {
  const info = getProvider(row.provider);
  const out: Record<string, string> = {};
  for (const f of info?.configFields ?? []) {
    const v = row.config?.[f.key];
    if (typeof v === "string") out[f.key] = v;
  }
  return out;
}

export function toSourceDTO(row: IntegrationRow): SourceDTO {
  const secret = readSecret<Record<string, unknown>>(row) ?? {};
  const cfg = row.config ?? {};
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    config: configStrings(row),
    secretKeys: Object.keys(secret).filter((k) => typeof secret[k] === "string" && secret[k] !== ""),
    tokenPrefix: row.tokenPrefix,
    eventCount: typeof cfg.eventCount === "number" ? cfg.eventCount : 0,
    lastEventAt: typeof cfg.lastEventAt === "string" ? cfg.lastEventAt : null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSources(projectId: string): Promise<SourceDTO[]> {
  const rows = await listIntegrations(projectId);
  return rows.filter((r) => ATTRIBUTION_PROVIDER_KEYS.includes(r.provider)).map(toSourceDTO);
}

export async function getSourceRow(projectId: string, provider: string): Promise<IntegrationRow | null> {
  if (!getProvider(provider)) return null;
  return getIntegration(projectId, provider);
}

export async function getSourceById(id: string): Promise<IntegrationRow | null> {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return row && getProvider(row.provider) ? row : null;
}

export function sourceSecretsOf(row: IntegrationRow | null): Record<string, string> {
  if (!row) return {};
  const s = readSecret<Record<string, unknown>>(row) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Resolves a source-specific inbound token for a project (null when it belongs elsewhere). */
export async function findSourceByToken(projectId: string, token: string): Promise<IntegrationRow | null> {
  const row = await findIntegrationByToken(token);
  if (!row || row.projectId !== projectId || !getProvider(row.provider)) return null;
  return row;
}

/**
 * Connects (or updates) a provider. Webhook providers get a fresh inbound token (returned once);
 * secrets marked `generate` are generated when not supplied and returned once as well.
 */
export async function connectSource(
  projectId: string,
  provider: string,
  input: { secrets?: Record<string, string>; config?: Record<string, string>; regenerateToken?: boolean },
  actorId: string | null,
): Promise<{ source: SourceDTO; token: string | null; generatedSecrets: Record<string, string> }> {
  const info = getProvider(provider);
  if (!info) throw new Error("Unknown provider");
  const existing = await getIntegration(projectId, provider);
  const secrets = { ...sourceSecretsOf(existing) };
  const generatedSecrets: Record<string, string> = {};
  for (const f of info.secretFields ?? []) {
    const v = input.secrets?.[f.key]?.trim();
    if (v) secrets[f.key] = v.slice(0, 500);
    else if (!secrets[f.key] && f.generate) {
      secrets[f.key] = randomToken(24);
      generatedSecrets[f.key] = secrets[f.key]!;
    }
  }
  const missing = (info.secretFields ?? []).filter((f) => !f.generate && !secrets[f.key]);
  if (missing.length && info.kind === "api_import") throw new Error(`Missing ${missing.map((m) => m.label).join(", ")}`);

  const mergeConfig: Record<string, unknown> = { attribution: true, kind: info.kind };
  for (const f of info.configFields ?? []) {
    const v = input.config?.[f.key];
    if (v !== undefined) mergeConfig[f.key] = String(v).trim().slice(0, 200);
  }
  let row = await saveIntegration({
    projectId,
    provider,
    status: "connected",
    mergeConfig,
    secret: Object.keys(secrets).length ? secrets : null,
    connectedBy: existing?.connectedBy ?? actorId,
    lastError: null,
  });

  let token: string | null = null;
  const needsToken = info.kind === "webhook" || info.kind === "signed_webhook";
  if (needsToken && (!row.tokenHash || input.regenerateToken || existing?.status === "disconnected")) {
    const issued = await issueIngestToken({ projectId, provider, connectedBy: actorId });
    token = issued.token;
    row = issued.integration;
  }
  return { source: toSourceDTO(row), token, generatedSecrets };
}

export async function disconnectSource(projectId: string, provider: string) {
  if (!getProvider(provider)) return;
  const row = await getIntegration(projectId, provider);
  if (!row) return;
  await revokeIngestToken(projectId, provider);
  await saveIntegration({ projectId, provider, status: "disconnected", secret: null });
}

/** Counts an inbound event on the integration row (and marks it connected). */
export async function recordSourceEvent(row: IntegrationRow | null) {
  if (!row || row.status === "disconnected") return;
  const cfg = row.config ?? {};
  const eventCount = (typeof cfg.eventCount === "number" ? cfg.eventCount : 0) + 1;
  await saveIntegration({
    projectId: row.projectId,
    provider: row.provider,
    mergeConfig: { eventCount, lastEventAt: new Date().toISOString() },
    lastError: null,
    ...(row.status === "error" ? { status: "connected" as const } : {}),
  });
}

/**
 * Counts a Shopify Custom Pixel event on an installed Shopify integration. Rows are only created by
 * “Mark as installed” (attribution.manage) — never by public pixel traffic.
 */
export async function touchPixelSource(projectId: string, provider: "shopify") {
  const row = await getIntegration(projectId, provider);
  if (!row || row.status === "disconnected" || row.config?.attribution !== true) return;
  const last = typeof row.config?.lastEventAt === "string" ? Date.parse(row.config.lastEventAt) : 0;
  if (Date.now() - last > 60_000) await recordSourceEvent(row);
}

export async function markSourceError(row: IntegrationRow, message: string) {
  await markIntegrationSync(row.projectId, row.provider, { ok: false, error: message.slice(0, 500) });
}

/** Import-capable sources that are connected (for the hourly schedule). */
export async function listImportSources(providers: string[]) {
  return db
    .select({ id: integrations.id, projectId: integrations.projectId, provider: integrations.provider })
    .from(integrations)
    .where(and(inArray(integrations.provider, providers), ne(integrations.status, "disconnected")));
}
