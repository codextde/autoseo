import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { googleAccounts, integrations, projects, users } from "@/server/db/schema";
import { decryptJson, encryptJson, sha256 } from "@/server/crypto";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { readSecret } from "../store";
import { IntegrationHttpError } from "../http";
import {
  GOOGLE_SCOPE,
  GoogleReconnectRequiredError,
  GoogleScopeMissingError,
  parseScopes,
  refreshGoogleToken,
  type GoogleTokenResponse,
  type GoogleUserInfo,
} from "./core";

export type GoogleAccountRow = typeof googleAccounts.$inferSelect;

/** Encrypted token material of a linked account. */
type AccountSecret = { refreshToken: string; accessToken?: string; expiresAt?: number };

/** Legacy per-integration grant (before workspace accounts existed). */
type LegacyGrant = { refreshToken?: string; accessToken?: string; expiresAt?: number; scope?: string; email?: string | null; sub?: string | null };

export type GoogleAccountCapabilities = { gsc: boolean; ga4: boolean; sheets: boolean };

export function accountCapabilities(scopes: string[]): GoogleAccountCapabilities {
  return { gsc: scopes.includes(GOOGLE_SCOPE.gsc), ga4: scopes.includes(GOOGLE_SCOPE.ga4), sheets: scopes.includes(GOOGLE_SCOPE.sheets) };
}

/** Client-safe view of a linked Google account. */
export type PublicGoogleAccount = {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  scopes: string[];
  can: GoogleAccountCapabilities;
  status: GoogleAccountRow["status"];
  lastError: string | null;
  connectedBy: { id: string; name: string | null; email: string } | null;
  connectedAt: string;
  lastUsedAt: string | null;
  /** Project integrations that use this account. */
  usage: { projectId: string; projectName: string; provider: string; property: string | null }[];
};

function readAccountSecret(row: Pick<GoogleAccountRow, "secret">): AccountSecret | null {
  if (!row.secret) return null;
  try {
    return decryptJson<AccountSecret>(row.secret);
  } catch {
    return null;
  }
}

export async function getGoogleAccount(accountId: string, workspaceId?: string): Promise<GoogleAccountRow | null> {
  const [row] = await db
    .select()
    .from(googleAccounts)
    .where(workspaceId ? and(eq(googleAccounts.id, accountId), eq(googleAccounts.workspaceId, workspaceId)) : eq(googleAccounts.id, accountId))
    .limit(1);
  return row ?? null;
}

/**
 * Creates or updates the workspace account for a fresh consent. Scopes are merged (incremental
 * consent) and the refresh token is kept when Google does not return a new one.
 */
export async function upsertGoogleAccount(input: {
  workspaceId: string;
  userId: string;
  info: GoogleUserInfo & { sub: string };
  tokens: GoogleTokenResponse;
}): Promise<GoogleAccountRow> {
  const [existing] = await db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.workspaceId, input.workspaceId), eq(googleAccounts.sub, input.info.sub)))
    .limit(1);
  const previous = existing ? readAccountSecret(existing) : null;
  const refreshToken = input.tokens.refresh_token ?? previous?.refreshToken;
  if (!refreshToken) {
    throw new GoogleReconnectRequiredError(
      "Google did not return a refresh token. Remove AutoSEO from your Google account permissions (myaccount.google.com → Security) and connect again.",
    );
  }
  const secret = encryptJson({
    refreshToken,
    accessToken: input.tokens.access_token,
    expiresAt: Date.now() + (input.tokens.expires_in ?? 3600) * 1000,
  } satisfies AccountSecret);
  const scopes = parseScopes([...(existing?.scopes ?? []), ...parseScopes(input.tokens.scope)]);
  const values = {
    email: input.info.email ?? existing?.email ?? null,
    name: input.info.name ?? existing?.name ?? null,
    picture: input.info.picture ?? existing?.picture ?? null,
    scopes,
    secret,
    status: "active" as const,
    lastError: null,
    connectedBy: input.userId,
  };
  const [row] = existing
    ? await db.update(googleAccounts).set({ ...values, updatedAt: new Date() }).where(eq(googleAccounts.id, existing.id)).returning()
    : await db
        .insert(googleAccounts)
        .values({ workspaceId: input.workspaceId, sub: input.info.sub, ...values })
        .onConflictDoUpdate({ target: [googleAccounts.workspaceId, googleAccounts.sub], set: { ...values, updatedAt: new Date() } })
        .returning();
  // A reconnect heals integrations that failed because of this account's grant.
  await db
    .update(integrations)
    .set({ status: "connected", lastError: null, updatedAt: new Date() })
    .where(
      and(
        inArray(integrations.provider, [PROVIDERS.gsc, PROVIDERS.ga4]),
        eq(integrations.status, "error"),
        sql`${integrations.config}->>'googleAccountId' = ${row!.id}`,
      ),
    );
  return row!;
}

/* ───────────────────────────── Access tokens ───────────────────────────── */

const inflight = new Map<string, Promise<string>>();

async function markAccountBroken(account: GoogleAccountRow, message: string) {
  await db.update(googleAccounts).set({ status: "error", lastError: message, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  await db
    .update(integrations)
    .set({ status: "error", lastError: message, updatedAt: new Date() })
    .where(and(inArray(integrations.provider, [PROVIDERS.gsc, PROVIDERS.ga4]), sql`${integrations.config}->>'googleAccountId' = ${account.id}`));
}

async function refreshAccount(account: GoogleAccountRow, secret: AccountSecret): Promise<string> {
  let tokens: GoogleTokenResponse;
  try {
    tokens = await refreshGoogleToken(secret.refreshToken);
  } catch (err) {
    if (err instanceof IntegrationHttpError && (err.status === 400 || err.status === 401)) {
      const reason = /invalid_grant/.test(err.body) ? "The Google grant was revoked or expired." : "Google rejected the refresh token.";
      const message = `${reason} Reconnect ${account.email ?? "the Google account"}.`;
      await markAccountBroken(account, message);
      throw new GoogleReconnectRequiredError(message);
    }
    throw err;
  }
  const next: AccountSecret = {
    refreshToken: tokens.refresh_token ?? secret.refreshToken,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  await db
    .update(googleAccounts)
    .set({
      secret: encryptJson(next),
      ...(tokens.scope ? { scopes: parseScopes([...account.scopes, ...parseScopes(tokens.scope)]) } : {}),
      status: "active",
      lastError: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, account.id));
  return tokens.access_token;
}

/**
 * Valid access token of a linked account (refreshing when needed). With `workspaceId` the account
 * must belong to that workspace; with `scope` the account must have granted it.
 */
export async function getAccountAccessToken(accountId: string, opts: { workspaceId?: string; scope?: string } = {}): Promise<string> {
  const account = await getGoogleAccount(accountId, opts.workspaceId);
  if (!account) throw new GoogleReconnectRequiredError("The Google account was removed. Connect a Google account again.");
  if (account.status === "revoked") throw new GoogleReconnectRequiredError(`Reconnect ${account.email ?? "the Google account"}.`);
  if (opts.scope && !account.scopes.includes(opts.scope)) {
    throw new GoogleScopeMissingError(opts.scope, `${account.email ?? "The Google account"} has not granted this permission yet — reconnect it to grant access.`);
  }
  const secret = readAccountSecret(account);
  if (!secret?.refreshToken) throw new GoogleReconnectRequiredError(`Reconnect ${account.email ?? "the Google account"}.`);
  if (secret.accessToken && secret.expiresAt && secret.expiresAt - 60_000 > Date.now()) return secret.accessToken;
  const pending = inflight.get(account.id);
  if (pending) return pending;
  const p = refreshAccount(account, secret).finally(() => inflight.delete(account.id));
  inflight.set(account.id, p);
  return p;
}

/* ───────────────────────────── Listing ───────────────────────────── */

function propertyOf(provider: string, config: Record<string, unknown>): string | null {
  const v = provider === PROVIDERS.gsc ? config.siteUrl : (config.propertyName ?? config.propertyId);
  return typeof v === "string" && v ? v : null;
}

export async function listGoogleAccounts(workspaceId: string): Promise<PublicGoogleAccount[]> {
  await migrateLegacyGoogleGrants({ workspaceId });
  const [rows, usage] = await Promise.all([
    db
      .select({ account: googleAccounts, user: { id: users.id, name: users.name, email: users.email } })
      .from(googleAccounts)
      .leftJoin(users, eq(users.id, googleAccounts.connectedBy))
      .where(eq(googleAccounts.workspaceId, workspaceId))
      .orderBy(googleAccounts.createdAt),
    db
      .select({ projectId: projects.id, projectName: projects.name, provider: integrations.provider, config: integrations.config })
      .from(integrations)
      .innerJoin(projects, eq(projects.id, integrations.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(integrations.provider, [PROVIDERS.gsc, PROVIDERS.ga4]),
          sql`coalesce(${integrations.config}->>'googleAccountId', '') <> ''`,
        ),
      ),
  ]);
  return rows.map(({ account: a, user }) => ({
    id: a.id,
    email: a.email,
    name: a.name,
    picture: a.picture,
    scopes: a.scopes,
    can: accountCapabilities(a.scopes),
    status: a.status,
    lastError: a.lastError,
    connectedBy: user?.id ? { id: user.id, name: user.name, email: user.email } : null,
    connectedAt: a.createdAt.toISOString(),
    lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
    usage: usage
      .filter((u) => u.config.googleAccountId === a.id)
      .map((u) => ({ projectId: u.projectId, projectName: u.projectName, provider: u.provider, property: propertyOf(u.provider, u.config) })),
  }));
}

/** The account the current user uses for Sheets exports (linked by them, with `drive.file`). */
export async function findSheetsAccount(workspaceId: string, userId: string): Promise<GoogleAccountRow | null> {
  const rows = await db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.workspaceId, workspaceId), eq(googleAccounts.connectedBy, userId)))
    .orderBy(sql`${googleAccounts.lastUsedAt} desc nulls last`);
  return rows.find((r) => r.status !== "revoked" && r.scopes.includes(GOOGLE_SCOPE.sheets)) ?? null;
}

/* ───────────────────────────── Legacy migration ───────────────────────────── */

/**
 * Moves grants stored on google_* integration rows (single-account model) into workspace accounts
 * and links the rows via `config.googleAccountId`. Idempotent and safe to call on every read.
 */
export async function migrateLegacyGoogleGrants(filter: { workspaceId?: string; projectId?: string } = {}): Promise<number> {
  const conditions = [
    inArray(integrations.provider, [PROVIDERS.gsc, PROVIDERS.ga4]),
    isNotNull(integrations.secret),
    sql`coalesce(${integrations.config}->>'googleAccountId', '') = ''`,
  ];
  if (filter.workspaceId) conditions.push(eq(projects.workspaceId, filter.workspaceId));
  if (filter.projectId) conditions.push(eq(integrations.projectId, filter.projectId));
  const rows = await db
    .select({ integration: integrations, workspaceId: projects.workspaceId })
    .from(integrations)
    .innerJoin(projects, eq(projects.id, integrations.projectId))
    .where(and(...conditions));
  let migrated = 0;
  for (const { integration, workspaceId } of rows) {
    const grant = readSecret<LegacyGrant>(integration);
    if (!grant?.refreshToken) continue;
    const cfg = integration.config ?? {};
    const sub = grant.sub ?? (typeof cfg.accountSub === "string" ? cfg.accountSub : null) ?? `legacy-${sha256(grant.refreshToken).slice(0, 24)}`;
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(googleAccounts)
        .where(and(eq(googleAccounts.workspaceId, workspaceId), eq(googleAccounts.sub, sub)))
        .limit(1);
      const scopes = parseScopes([...(existing?.scopes ?? []), ...parseScopes(grant.scope)]);
      let accountId = existing?.id;
      if (existing) {
        await tx
          .update(googleAccounts)
          .set({
            scopes,
            // Keep the account's own token; only fill it when missing.
            ...(existing.secret ? {} : { secret: encryptJson({ refreshToken: grant.refreshToken, accessToken: grant.accessToken, expiresAt: grant.expiresAt }) }),
            email: existing.email ?? grant.email ?? null,
            updatedAt: new Date(),
          })
          .where(eq(googleAccounts.id, existing.id));
      } else {
        const [created] = await tx
          .insert(googleAccounts)
          .values({
            workspaceId,
            sub,
            email: grant.email ?? (typeof cfg.email === "string" ? cfg.email : null),
            scopes,
            secret: encryptJson({ refreshToken: grant.refreshToken, accessToken: grant.accessToken, expiresAt: grant.expiresAt }),
            connectedBy: integration.connectedBy,
            createdAt: integration.createdAt,
          })
          .returning({ id: googleAccounts.id });
        accountId = created!.id;
      }
      await tx
        .update(integrations)
        .set({ config: { ...cfg, googleAccountId: accountId }, secret: null, updatedAt: new Date() })
        .where(eq(integrations.id, integration.id));
    });
    migrated++;
  }
  return migrated;
}

/** Deletes the account row (tokens included). Callers disconnect dependent integrations first. */
export async function deleteGoogleAccountRow(accountId: string) {
  const [row] = await db.delete(googleAccounts).where(eq(googleAccounts.id, accountId)).returning();
  return row ?? null;
}

/** Whether another workspace still links the same Google account (then its grant must not be revoked). */
export async function isGoogleSubLinkedElsewhere(sub: string, exceptAccountId: string): Promise<boolean> {
  const rows = await db.select({ id: googleAccounts.id }).from(googleAccounts).where(eq(googleAccounts.sub, sub));
  return rows.some((r) => r.id !== exceptAccountId);
}

export function accountRefreshToken(row: GoogleAccountRow): string | null {
  return readAccountSecret(row)?.refreshToken ?? null;
}
