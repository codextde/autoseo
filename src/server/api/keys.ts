import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, apiRequestLogs, oauthClients, oauthGrants, oauthRefreshTokens, projects, users } from "@/server/db/schema";
import { API_KEY_PREFIX, type ApiScope } from "@/features/api-settings/scopes";
import type { ApiKeyView, ApiUsage, OAuthGrantView } from "@/features/api-settings/types";
import { newId } from "@/server/db/schema/_helpers";
import { generateSecret } from "./tokens";

export type { ApiKeyView, ApiUsage, OAuthGrantView };

/** Creates an API key. The plaintext token is returned exactly once; only its SHA-256 hash is stored. */
export async function createApiKey(input: {
  workspaceId: string;
  userId: string;
  name: string;
  scopes: ApiScope[];
  projectIds: string[] | null;
}) {
  const { token, hash, displayPrefix } = generateSecret(API_KEY_PREFIX);
  const scopes = Array.from(new Set<ApiScope>(["read", ...input.scopes]));
  const [row] = await db
    .insert(apiKeys)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name,
      prefix: displayPrefix,
      keyHash: hash,
      scopes,
      projectIds: input.projectIds && input.projectIds.length ? input.projectIds : null,
      kind: "api",
    })
    .returning();
  return { key: row!, token };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyView[]> {
  const rows = await db
    .select({ key: apiKeys, user: { id: users.id, name: users.name, email: users.email } })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.kind, "api"), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  const allIds = [...new Set(rows.flatMap((r) => r.key.projectIds ?? []))];
  const names = new Map<string, string>();
  if (allIds.length) {
    for (const p of await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, allIds))) {
      names.set(p.id, p.name);
    }
  }
  return rows.map(({ key, user }) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes as ApiScope[],
    projectIds: key.projectIds ?? null,
    projectNames: (key.projectIds ?? []).map((id) => names.get(id) ?? id),
    requestCount: key.requestCount,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    createdBy: user,
  }));
}

/**
 * Revokes a key. `revokeApiKey(workspaceId, keyId)` is used by the settings UI (manual keys only);
 * `revokeApiKey(keyId)` revokes any key kind by id (e.g. an ephemeral session key when a chat ends).
 */
export async function revokeApiKey(keyId: string): Promise<{ id: string; name: string } | null>;
export async function revokeApiKey(workspaceId: string, keyId: string): Promise<{ id: string; name: string } | null>;
export async function revokeApiKey(a: string, b?: string) {
  const where =
    b === undefined
      ? and(eq(apiKeys.id, a), isNull(apiKeys.revokedAt))
      : and(eq(apiKeys.id, b), eq(apiKeys.workspaceId, a), eq(apiKeys.kind, "api"), isNull(apiKeys.revokedAt));
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(where).returning({ id: apiKeys.id, name: apiKeys.name });
  return row ?? null;
}

/* ───────────────────────────── Ephemeral session keys ───────────────────────────── */

/** Id prefix of session keys — request logs keep it after the key is purged, so usage stays separable. */
export const SESSION_KEY_ID_PREFIX = "aks";
export const SESSION_KEY_MAX_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Short-lived, hashed API key for a local agent chat session (Claude Code connects to /api/mcp
 * with it). Hidden from the key list, reported separately in usage, rejected by the auth layer
 * once `expiresAt` passes, and purged by the daily cleanup job. TTL is capped at 6 hours.
 */
export async function createEphemeralApiKey(input: {
  workspaceId: string;
  userId: string;
  /** null = all projects the user can access */
  projectIds: string[] | null;
  scopes: ApiScope[];
  ttlMs: number;
  /** Shown as the credential name in whoami / logs, e.g. "Agent chat · Solakon". */
  label: string;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const ttl = Math.max(60_000, Math.min(input.ttlMs, SESSION_KEY_MAX_TTL_MS));
  const { token, hash, displayPrefix } = generateSecret(API_KEY_PREFIX);
  const scopes = Array.from(new Set<ApiScope>(["read", ...input.scopes]));
  const expiresAt = new Date(Date.now() + ttl);
  const [row] = await db
    .insert(apiKeys)
    .values({
      id: newId(SESSION_KEY_ID_PREFIX),
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.label.slice(0, 120) || "Agent session",
      prefix: displayPrefix,
      keyHash: hash,
      scopes,
      projectIds: input.projectIds && input.projectIds.length ? input.projectIds : null,
      kind: "session",
      expiresAt,
    })
    .returning({ id: apiKeys.id });
  return { id: row!.id, token, expiresAt };
}

/* ───────────────────────────── Usage ───────────────────────────── */

export async function getApiUsage(workspaceId: string): Promise<ApiUsage> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);
  const day = sql<string>`to_char(date_trunc('day', ${apiRequestLogs.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const isSession = sql`coalesce(${apiRequestLogs.apiKeyId}, '') like ${`${SESSION_KEY_ID_PREFIX}\_%`}`;
  const rows = await db
    .select({
      date: day,
      requests: sql<number>`count(*) filter (where not ${isSession})::int`,
      errors: sql<number>`count(*) filter (where not ${isSession} and ${apiRequestLogs.status} >= 400)::int`,
      sessions: sql<number>`count(*) filter (where ${isSession})::int`,
    })
    .from(apiRequestLogs)
    .where(and(eq(apiRequestLogs.workspaceId, workspaceId), gte(apiRequestLogs.createdAt, since)))
    .groupBy(day);
  const map = new Map(rows.map((r) => [r.date, r]));
  const days: ApiUsage["days"] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10);
    const r = map.get(d);
    days.push({ date: d, requests: r?.requests ?? 0, errors: r?.errors ?? 0 });
  }
  return {
    days,
    today: days[days.length - 1]?.requests ?? 0,
    total30: days.reduce((s, d) => s + d.requests, 0),
    sessionRequests30: rows.reduce((s, r) => s + Number(r.sessions), 0),
  };
}

/* ───────────────────────────── Connected OAuth apps ───────────────────────────── */

function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    return u.host || `${u.protocol}//`;
  } catch {
    return uri.slice(0, 60);
  }
}

/** Active OAuth grants in a workspace (optionally only for one user). */
export async function listOAuthGrants(workspaceId: string, onlyUserId?: string): Promise<OAuthGrantView[]> {
  const rows = await db
    .select({ grant: oauthGrants, client: oauthClients, user: { id: users.id, name: users.name, email: users.email } })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(
      and(
        eq(oauthGrants.workspaceId, workspaceId),
        isNull(oauthGrants.revokedAt),
        onlyUserId ? eq(oauthGrants.userId, onlyUserId) : undefined,
      ),
    )
    .orderBy(desc(oauthGrants.createdAt));
  if (!rows.length) return [];

  const stats = await db
    .select({
      clientId: apiKeys.oauthClientId,
      userId: apiKeys.userId,
      requests: sql<number>`coalesce(sum(${apiKeys.requestCount}), 0)::int`,
      lastUsedAt: sql<Date | null>`max(${apiKeys.lastUsedAt})`,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.kind, "oauth")))
    .groupBy(apiKeys.oauthClientId, apiKeys.userId);
  const statMap = new Map(stats.map((s) => [`${s.clientId}:${s.userId}`, s]));

  const allIds = [...new Set(rows.flatMap((r) => r.grant.projectIds ?? []))];
  const names = new Map<string, string>();
  if (allIds.length) {
    for (const p of await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, allIds))) {
      names.set(p.id, p.name);
    }
  }

  return rows.map(({ grant, client, user }) => {
    const s = statMap.get(`${client.id}:${user.id}`);
    const last = s?.lastUsedAt ? new Date(s.lastUsedAt) : grant.lastUsedAt;
    return {
      id: grant.id,
      clientId: client.id,
      clientName: client.name,
      redirectHosts: [...new Set(client.redirectUris.map(hostOf))],
      scopes: grant.scopes,
      projectIds: grant.projectIds ?? null,
      projectNames: (grant.projectIds ?? []).map((id) => names.get(id) ?? id),
      user,
      createdAt: grant.createdAt.toISOString(),
      lastUsedAt: last ? last.toISOString() : null,
      requestCount: s?.requests ?? 0,
    };
  });
}

/** Revokes a grant plus every refresh token and access token issued under it. */
export async function revokeOAuthGrant(grantId: string, scope: { workspaceId: string; userId?: string }) {
  const [grant] = await db
    .update(oauthGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthGrants.id, grantId),
        eq(oauthGrants.workspaceId, scope.workspaceId),
        scope.userId ? eq(oauthGrants.userId, scope.userId) : undefined,
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning();
  if (!grant) return null;
  await revokeGrantTokens(grant);
  return grant;
}

export async function revokeGrantTokens(grant: { id: string; clientId: string; userId: string; workspaceId: string }) {
  const now = new Date();
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthRefreshTokens.grantId, grant.id), isNull(oauthRefreshTokens.revokedAt)));
  await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiKeys.kind, "oauth"),
        eq(apiKeys.oauthClientId, grant.clientId),
        eq(apiKeys.userId, grant.userId),
        eq(apiKeys.workspaceId, grant.workspaceId),
        isNull(apiKeys.revokedAt),
      ),
    );
}
