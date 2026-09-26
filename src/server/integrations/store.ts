import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations } from "@/server/db/schema";
import { decryptJson, encryptJson, randomToken, sha256 } from "@/server/crypto";
import { PROVIDERS } from "@/lib/integrations-catalog";

export type IntegrationRow = typeof integrations.$inferSelect;
/** `db` or a transaction handle. */
export type DbExec = Pick<typeof db, "select" | "insert" | "update" | "delete">;
export type IntegrationStatus = IntegrationRow["status"];

/** Client-safe view of an integration (no secret, no token hash). */
export type PublicIntegration = {
  id: string;
  provider: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  hasSecret: boolean;
  tokenPrefix: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toPublicIntegration(row: IntegrationRow): PublicIntegration {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    config: row.config ?? {},
    hasSecret: !!row.secret,
    tokenPrefix: row.tokenPrefix,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The integration row of a project for a provider (or null). Always scoped by projectId. */
export async function getIntegration(projectId: string, provider: string, exec: DbExec = db): Promise<IntegrationRow | null> {
  const [row] = await exec
    .select()
    .from(integrations)
    .where(and(eq(integrations.projectId, projectId), eq(integrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function listIntegrations(projectId: string): Promise<IntegrationRow[]> {
  return db.select().from(integrations).where(eq(integrations.projectId, projectId));
}

/** Decrypted secret JSON of an integration (server-only). */
export async function getIntegrationSecret<T = Record<string, unknown>>(
  projectId: string,
  provider: string,
): Promise<T | null> {
  const row = await getIntegration(projectId, provider);
  return row ? readSecret<T>(row) : null;
}

export function readSecret<T = Record<string, unknown>>(row: Pick<IntegrationRow, "secret">): T | null {
  if (!row.secret) return null;
  try {
    return decryptJson<T>(row.secret);
  } catch (err) {
    console.error("[integrations] could not decrypt secret", err);
    return null;
  }
}

export type SaveIntegrationInput = {
  projectId: string;
  provider: string;
  status?: IntegrationStatus;
  /** Replaces the non-secret config when set (use `mergeConfig` to patch). */
  config?: Record<string, unknown>;
  mergeConfig?: Record<string, unknown>;
  /** Replaces the encrypted secret when set; `null` clears it. */
  secret?: Record<string, unknown> | null;
  /** Merges into the existing secret (decrypt → merge → encrypt). */
  mergeSecret?: Record<string, unknown>;
  connectedBy?: string | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
};

/** Upserts the (projectId, provider) integration row. */
export async function saveIntegration(input: SaveIntegrationInput, exec: DbExec = db): Promise<IntegrationRow> {
  const existing = await getIntegration(input.projectId, input.provider, exec);
  let config = input.config ?? existing?.config ?? {};
  if (input.mergeConfig) config = { ...config, ...input.mergeConfig };
  let secret: string | null | undefined = undefined;
  if (input.secret !== undefined) secret = input.secret === null ? null : encryptJson(input.secret);
  if (input.mergeSecret) {
    const current = existing ? (readSecret<Record<string, unknown>>(existing) ?? {}) : {};
    const base = input.secret && input.secret !== null ? input.secret : current;
    secret = encryptJson({ ...base, ...input.mergeSecret });
  }
  if (existing) {
    const [row] = await exec
      .update(integrations)
      .set({
        config,
        ...(input.status ? { status: input.status } : {}),
        ...(secret !== undefined ? { secret } : {}),
        ...(input.connectedBy !== undefined ? { connectedBy: input.connectedBy } : {}),
        ...(input.lastSyncAt !== undefined ? { lastSyncAt: input.lastSyncAt } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await exec
    .insert(integrations)
    .values({
      projectId: input.projectId,
      provider: input.provider,
      status: input.status ?? "connected",
      config,
      secret: secret ?? null,
      connectedBy: input.connectedBy ?? null,
      lastSyncAt: input.lastSyncAt ?? null,
      lastError: input.lastError ?? null,
    })
    .onConflictDoUpdate({
      target: [integrations.projectId, integrations.provider],
      set: {
        config,
        status: input.status ?? "connected",
        ...(secret !== undefined ? { secret } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

/** Identity of the external source an analytics integration syncs from (property / site / account). */
export function integrationTarget(provider: string, config: Record<string, unknown> | null | undefined): string {
  const c = config ?? {};
  const s = (k: string) => (c[k] == null ? "" : String(c[k]));
  switch (provider) {
    case PROVIDERS.gsc:
    case PROVIDERS.bing:
      return s("siteUrl");
    case PROVIDERS.ga4:
      return s("propertyId");
    case PROVIDERS.matomo:
      return `${s("url")}|${s("siteId")}`;
    case PROVIDERS.piwik:
      return `${s("accountUrl")}|${s("websiteId")}`;
    default:
      return "";
  }
}

/**
 * Records the outcome of a sync on the integration row. With `expectTarget`, nothing is written
 * when the integration meanwhile points at another property/site (a newer sync owns the row).
 */
export async function markIntegrationSync(
  projectId: string,
  provider: string,
  outcome: { ok: true; config?: Record<string, unknown> } | { ok: false; error: string; status?: IntegrationStatus },
  expectTarget?: string,
) {
  const existing = await getIntegration(projectId, provider);
  if (!existing) return;
  if (expectTarget !== undefined && integrationTarget(provider, existing.config) !== expectTarget) return;
  await db
    .update(integrations)
    .set(
      outcome.ok
        ? {
            lastSyncAt: new Date(),
            lastError: null,
            status: existing.status === "pending" ? "pending" : "connected",
            ...(outcome.config ? { config: { ...existing.config, ...outcome.config } } : {}),
            updatedAt: new Date(),
          }
        : { lastError: outcome.error.slice(0, 1000), status: outcome.status ?? "error", updatedAt: new Date() },
    )
    .where(eq(integrations.id, existing.id));
}

export async function deleteIntegration(projectId: string, provider: string, exec: DbExec = db): Promise<IntegrationRow | null> {
  const [row] = await exec
    .delete(integrations)
    .where(and(eq(integrations.projectId, projectId), eq(integrations.provider, provider)))
    .returning();
  return row ?? null;
}

/* ───────────────────────────── Inbound tokens ───────────────────────────── */

export const INGEST_TOKEN_PREFIX = "fslg_";

/**
 * Creates (or rotates) the inbound token of an integration. The plain token is returned once;
 * only its SHA-256 hash and a short display prefix are stored.
 */
export async function issueIngestToken(input: {
  projectId: string;
  provider: string;
  connectedBy?: string | null;
  config?: Record<string, unknown>;
}): Promise<{ token: string; prefix: string; integration: IntegrationRow }> {
  const token = `${INGEST_TOKEN_PREFIX}${randomToken(24)}`;
  const prefix = token.slice(0, INGEST_TOKEN_PREFIX.length + 6);
  const existing = await getIntegration(input.projectId, input.provider);
  const config = { ...(existing?.config ?? {}), ...(input.config ?? {}), tokenCreatedAt: new Date().toISOString() };
  let row: IntegrationRow;
  if (existing) {
    [row] = (await db
      .update(integrations)
      .set({ tokenHash: sha256(token), tokenPrefix: prefix, status: "connected", config, updatedAt: new Date() })
      .where(eq(integrations.id, existing.id))
      .returning()) as [IntegrationRow];
  } else {
    [row] = (await db
      .insert(integrations)
      .values({
        projectId: input.projectId,
        provider: input.provider,
        status: "connected",
        config,
        tokenHash: sha256(token),
        tokenPrefix: prefix,
        connectedBy: input.connectedBy ?? null,
      })
      .returning()) as [IntegrationRow];
  }
  return { token, prefix, integration: row };
}

/** Resolves an inbound bearer token to its integration (constant-time via hash lookup). */
export async function findIntegrationByToken(token: string): Promise<IntegrationRow | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const [row] = await db.select().from(integrations).where(eq(integrations.tokenHash, sha256(token))).limit(1);
  if (!row || row.status === "disconnected") return null;
  return row;
}

export async function revokeIngestToken(projectId: string, provider: string) {
  await db
    .update(integrations)
    .set({ tokenHash: null, tokenPrefix: null, status: "disconnected", updatedAt: new Date() })
    .where(and(eq(integrations.projectId, projectId), eq(integrations.provider, provider)));
}
