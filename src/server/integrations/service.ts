import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects, scDaily, scPages, scQueries, trafficDaily, trafficRows } from "@/server/db/schema";
import {
  destinationChanged,
  getCatalogEntry,
  isInlineTokenProvider,
  normalizeFieldValue,
  PROVIDERS,
  type CatalogEntry,
  type TokenField,
} from "@/lib/integrations-catalog";
import { cancelAnalyticsSync, enqueueAnalyticsSync, lockSyncTarget } from "@/server/analytics/scheduling";
import {
  deleteIntegration,
  getIntegration,
  readSecret,
  revokeIngestToken,
  type DbExec,
  saveIntegration,
  toPublicIntegration,
  type PublicIntegration,
} from "./store";
import {
  getGoogleOAuthStatus,
  GOOGLE_PRODUCT_PROVIDER,
  GOOGLE_PRODUCT_SCOPE,
  googleApiErrorMessage,
  revokeGoogleToken,
  type GoogleProduct,
} from "./google/oauth";
import { gscListSites } from "./google/gsc";
import { ga4GetProperty, ga4ListProperties, ga4PropertyNumber } from "./google/ga4";
import {
  accountRefreshToken,
  deleteGoogleAccountRow,
  getAccountAccessToken,
  getGoogleAccount,
  isGoogleSubLinkedElsewhere,
  listGoogleAccounts,
  migrateLegacyGoogleGrants,
  type PublicGoogleAccount,
} from "./google/accounts";
import { bingSiteMatchesDomain, testBingConnection } from "./bing";
import { testMatomoConnection } from "./matomo";
import { testPiwikConnection } from "./piwik";
import { getSetting } from "@/server/settings";

/* ───────────────────────────── Google connection state ───────────────────────────── */

export type GoogleConnectionState = {
  product: GoogleProduct;
  provider: string;
  oauthConfigured: boolean;
  redirectUri: string;
  status: "not_connected" | "pending" | "connected" | "error";
  email: string | null;
  /** Linked workspace account used by this connection. */
  account: { id: string; email: string | null; name: string | null; picture: string | null } | null;
  /** Workspace accounts that granted this product's scope (for the account picker). */
  accounts: PublicGoogleAccount[];
  /** GSC site URL or GA4 "properties/N" */
  propertyId: string | null;
  propertyName: string | null;
  timeZone: string | null;
  currency: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  demo: boolean;
};

/**
 * Connection state for the GSC / GA4 cards. `includeAccounts` (default false) adds the workspace's
 * linked accounts for the picker — only pass true for users who may manage integrations.
 */
export async function getGoogleConnectionState(
  projectId: string,
  product: GoogleProduct,
  opts: { includeAccounts?: boolean } = {},
): Promise<GoogleConnectionState> {
  const provider = GOOGLE_PRODUCT_PROVIDER[product];
  await migrateLegacyGoogleGrants({ projectId });
  const [row, oauth, [project]] = await Promise.all([
    getIntegration(projectId, provider),
    getGoogleOAuthStatus(),
    db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1),
  ]);
  const all = project ? await listGoogleAccounts(project.workspaceId) : [];
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const propertyId = product === "gsc" ? str(cfg.siteUrl) : str(cfg.propertyId);
  const linked = all.find((a) => a.id === cfg.googleAccountId) ?? null;
  return {
    product,
    provider,
    oauthConfigured: oauth.configured,
    redirectUri: oauth.redirectUri,
    status: !row
      ? "not_connected"
      : row.status === "pending" || !propertyId
        ? "pending"
        : row.status === "error"
          ? "error"
          : "connected",
    email: linked?.email ?? str(cfg.email),
    account: linked ? { id: linked.id, email: linked.email, name: linked.name, picture: linked.picture } : null,
    accounts: opts.includeAccounts ? all.filter((a) => a.can[product]) : [],
    propertyId,
    propertyName: product === "gsc" ? (propertyId ? formatGscSite(propertyId) : null) : str(cfg.propertyName),
    timeZone: str(cfg.timeZone),
    currency: str(cfg.currency),
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    connectedAt: str(cfg.connectedAt) ?? row?.createdAt.toISOString() ?? null,
    demo: cfg.demo === true,
  };
}

/** "sc-domain:example.com" → "example.com (Domain property)". */
export function formatGscSite(siteUrl: string): string {
  return siteUrl.startsWith("sc-domain:") ? `${siteUrl.slice(10)} (Domain property)` : siteUrl;
}

export type GooglePropertyOption = {
  id: string;
  label: string;
  detail: string;
  selectable: boolean;
  recommended: boolean;
};

function hostMatches(candidate: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const c = candidate.toLowerCase().replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  return c === d || c.endsWith(`.${d}`) || d.endsWith(`.${c}`);
}

async function workspaceOf(projectId: string): Promise<string> {
  const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  return project.workspaceId;
}

/** Properties (GSC sites / GA4 properties) visible to a linked workspace account. */
export async function listGoogleProperties(
  projectId: string,
  product: GoogleProduct,
  projectDomain: string,
  accountId: string,
): Promise<GooglePropertyOption[]> {
  try {
    const token = await getAccountAccessToken(accountId, { workspaceId: await workspaceOf(projectId), scope: GOOGLE_PRODUCT_SCOPE[product] });
    if (product === "gsc") {
      const sites = await gscListSites(token);
      return sites
        .map((s) => ({
          id: s.siteUrl,
          label: formatGscSite(s.siteUrl),
          detail: s.permissionLevel === "siteUnverifiedUser" ? "No verified access" : permissionLabel(s.permissionLevel),
          selectable: s.permissionLevel !== "siteUnverifiedUser",
          recommended: hostMatches(s.siteUrl, projectDomain),
        }))
        .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.label.localeCompare(b.label));
    }
    const props = await ga4ListProperties(token);
    return props
      .map((p) => ({
        id: p.propertyId,
        label: p.displayName,
        detail: `${p.accountDisplayName ? `${p.accountDisplayName} · ` : ""}ID ${ga4PropertyNumber(p.propertyId)}`,
        selectable: true,
        recommended: hostMatches(p.displayName, projectDomain) || p.displayName.toLowerCase().includes(projectDomain.split(".")[0] ?? "~"),
      }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.label.localeCompare(b.label));
  } catch (err) {
    throw new Error(googleApiErrorMessage(err, product));
  }
}

function permissionLabel(level: string): string {
  return (
    { siteOwner: "Owner", siteFullUser: "Full user", siteRestrictedUser: "Restricted user" } as Record<string, string>
  )[level] ?? level;
}

export async function selectGoogleProperty(input: {
  projectId: string;
  product: GoogleProduct;
  accountId: string;
  propertyId: string;
  projectDomain: string;
  userId: string;
}) {
  const provider = GOOGLE_PRODUCT_PROVIDER[input.product];
  const workspaceId = await workspaceOf(input.projectId);
  const account = await getGoogleAccount(input.accountId, workspaceId);
  if (!account) throw new Error("This Google account is not linked to the workspace.");
  const row = await getIntegration(input.projectId, provider);
  const options = await listGoogleProperties(input.projectId, input.product, input.projectDomain, account.id);
  const option = options.find((o) => o.id === input.propertyId);
  if (!option) throw new Error(`This property is not available for ${account.email ?? "the selected Google account"}.`);
  if (!option.selectable) throw new Error("You need verified access to this Search Console property.");
  let extra: Record<string, unknown> = {};
  if (input.product === "ga4") {
    try {
      const token = await getAccountAccessToken(account.id, { workspaceId, scope: GOOGLE_PRODUCT_SCOPE.ga4 });
      const details = await ga4GetProperty(token, input.propertyId);
      extra = { propertyName: details.displayName, timeZone: details.timeZone, currency: details.currencyCode };
    } catch (err) {
      throw new Error(googleApiErrorMessage(err, "ga4"));
    }
  }
  const cfg = row?.config ?? {};
  const changed = (input.product === "gsc" ? cfg.siteUrl : cfg.propertyId) !== input.propertyId;
  // Changing the property invalidates previously synced data: stop running syncs, then delete the
  // data and switch the target atomically under the sync lock (in-flight writes re-check the target).
  if (changed) await cancelAnalyticsSync(input.projectId, provider);
  const saved = await db.transaction(async (tx) => {
    await lockSyncTarget(tx, input.projectId, provider);
    if (changed) await deleteSyncedData(input.projectId, provider, tx);
    return saveIntegration(
      {
        projectId: input.projectId,
        provider,
        status: "connected",
        config: {
          ...cfg,
          googleAccountId: account.id,
          email: account.email,
          connectedAt: (cfg.connectedAt as string | undefined) ?? new Date().toISOString(),
          ...(input.product === "gsc" ? { siteUrl: input.propertyId } : { propertyId: input.propertyId }),
          ...extra,
          selectedAt: new Date().toISOString(),
          syncedThrough: changed ? null : (cfg.syncedThrough ?? null),
          backfilledFrom: changed ? null : (cfg.backfilledFrom ?? null),
        },
        secret: null,
        connectedBy: row?.connectedBy ?? input.userId,
        lastError: null,
      },
      tx,
    );
  });
  await enqueueAnalyticsSync(input.projectId, provider, { full: true, createdBy: input.userId, priority: 20 });
  return toPublicIntegration(saved);
}

/* ───────────────────────────── Google accounts (workspace) ───────────────────────────── */

export type GoogleAccountImpact = {
  account: { id: string; email: string | null };
  integrations: { projectId: string; projectName: string; provider: string; property: string | null }[];
};

/** Which project connections lose their data when the account is removed. */
export async function googleAccountRemovalImpact(workspaceId: string, accountId: string): Promise<GoogleAccountImpact> {
  const accounts = await listGoogleAccounts(workspaceId);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Google account not found.");
  return { account: { id: account.id, email: account.email }, integrations: account.usage };
}

/**
 * Removes a linked account: disconnects every project integration that uses it (data included),
 * deletes the tokens and revokes the grant at Google unless another workspace links the same account.
 */
export async function removeGoogleAccount(workspaceId: string, accountId: string) {
  const impact = await googleAccountRemovalImpact(workspaceId, accountId);
  for (const i of impact.integrations) await disconnectIntegration(i.projectId, i.provider);
  const account = await getGoogleAccount(accountId, workspaceId);
  if (!account) return impact;
  const refreshToken = accountRefreshToken(account);
  await deleteGoogleAccountRow(account.id);
  if (!(await isGoogleSubLinkedElsewhere(account.sub, account.id))) await revokeGoogleToken(refreshToken);
  return impact;
}

/* ───────────────────────────── Disconnect ───────────────────────────── */

export async function deleteSyncedData(projectId: string, provider: string, exec: DbExec = db) {
  if (provider === PROVIDERS.gsc || provider === PROVIDERS.bing) {
    const source = provider === PROVIDERS.gsc ? "google" : "bing";
    await exec.delete(scDaily).where(and(eq(scDaily.projectId, projectId), eq(scDaily.source, source)));
    await exec.delete(scQueries).where(and(eq(scQueries.projectId, projectId), eq(scQueries.source, source)));
    await exec.delete(scPages).where(and(eq(scPages.projectId, projectId), eq(scPages.source, source)));
  }
  if (provider === PROVIDERS.ga4 || provider === PROVIDERS.matomo || provider === PROVIDERS.piwik) {
    const p = provider as "google_analytics" | "matomo" | "piwik_pro";
    await exec.delete(trafficRows).where(and(eq(trafficRows.projectId, projectId), eq(trafficRows.provider, p)));
    await exec.delete(trafficDaily).where(and(eq(trafficDaily.projectId, projectId), eq(trafficDaily.provider, p)));
  }
}

const INGEST_PROVIDERS: string[] = [PROVIDERS.cloudflare, PROVIDERS.akamai, PROVIDERS.serverLogs];

/** Disconnects an integration owned by the analytics module. Returns the removed row (public view). */
export async function disconnectIntegration(projectId: string, provider: string): Promise<PublicIntegration | null> {
  if (INGEST_PROVIDERS.includes(provider)) {
    await revokeIngestToken(projectId, provider);
    const row = await getIntegration(projectId, provider);
    return row ? toPublicIntegration(row) : null;
  }
  await cancelAnalyticsSync(projectId, provider);
  const row = await db.transaction(async (tx) => {
    await lockSyncTarget(tx, projectId, provider);
    const removed = await deleteIntegration(projectId, provider, tx);
    if (removed) await deleteSyncedData(projectId, provider, tx);
    return removed;
  });
  if (!row) return null;
  return toPublicIntegration(row);
}

/* ───────────────────────────── Token providers (generic dialog) ───────────────────────────── */

export function fieldSchema(field: TokenField, keepSecret: boolean): z.ZodType<string | undefined> {
  let s = z.string().trim().max(2000);
  if (field.type === "url")
    s = s.refine((v) => !v || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v), { message: "Enter a valid http(s) URL" }) as unknown as z.ZodString;
  if (field.pattern)
    s = s.refine((v) => !v || new RegExp(field.pattern!).test(v), { message: field.patternMessage ?? "Invalid value" }) as unknown as z.ZodString;
  const requiredNow = field.required && !(field.secret && keepSecret);
  return (requiredNow ? s.refine((v) => v.length > 0, { message: `${field.label} is required` }) : s.optional()) as z.ZodType<
    string | undefined
  >;
}

/** Validates dialog values against the catalog field definitions. */
export async function parseTokenValues(projectId: string, entry: CatalogEntry, values: Record<string, unknown>) {
  const existing = await getIntegration(projectId, entry.key);
  // Stored secrets are only reused while every destination field (e.g. the Matomo / Piwik PRO base
  // URL) is unchanged — otherwise a changed URL could send the stored secret to another host.
  const reuseSecrets = !!existing && !destinationChanged(entry, existing.config, values);
  const existingSecret = existing && reuseSecrets ? (readSecret<Record<string, string>>(existing) ?? {}) : {};
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const field of entry.fields ?? []) {
    const keep = !!existingSecret[field.key];
    const res = fieldSchema(field, keep).safeParse(values[field.key] ?? "");
    if (!res.success) {
      errors[field.key] =
        field.secret && existing && !reuseSecrets
          ? `${field.label} must be entered again because the URL changed`
          : (res.error.issues[0]?.message ?? "Invalid value");
      continue;
    }
    const v = res.data ?? "";
    if (field.secret) {
      if (v) secret[field.key] = v;
      else if (existingSecret[field.key]) secret[field.key] = existingSecret[field.key]!;
    } else if (v) config[field.key] = normalizeFieldValue(field, v);
  }
  if (Object.keys(errors).length) {
    const err = new Error(Object.values(errors).join(" · ")) as Error & { fieldErrors?: Record<string, string> };
    err.fieldErrors = errors;
    throw err;
  }
  return { config, secret, existing };
}

/** Runs the provider's connection test (throws a friendly error when it fails). */
export async function testTokenCredentials(
  provider: string,
  config: Record<string, string>,
  secret: Record<string, string>,
  ctx: { projectDomain: string },
) {
  switch (provider) {
    case PROVIDERS.bing: {
      if (secret.apiKey) return testBingConnection(secret.apiKey, config.siteUrl ?? "");
      const instanceKey = (await getSetting("integrations")).bingWebmasterApiKey;
      if (!instanceKey) throw new Error("Add an API key (or ask an admin to set the instance-wide key in Admin → Data Providers).");
      if (!bingSiteMatchesDomain(config.siteUrl ?? "", ctx.projectDomain))
        throw new Error(`The instance-wide Bing API key can only be used for sites on ${ctx.projectDomain}. Add your own API key for other sites.`);
      return testBingConnection(instanceKey, config.siteUrl ?? "", { revealSites: false });
    }
    case PROVIDERS.matomo:
      return testMatomoConnection({ url: config.url ?? "", siteId: config.siteId ?? "", tokenAuth: secret.tokenAuth ?? "" });
    case PROVIDERS.piwik:
      return testPiwikConnection({
        accountUrl: config.accountUrl ?? "",
        websiteId: config.websiteId ?? "",
        clientId: config.clientId ?? "",
        clientSecret: secret.clientSecret ?? "",
      });
    default:
      return "Saved. This provider cannot be tested automatically.";
  }
}

export async function saveTokenIntegration(input: {
  projectId: string;
  projectDomain: string;
  provider: string;
  values: Record<string, unknown>;
  userId: string;
  test: boolean;
}) {
  const entry = getCatalogEntry(input.provider);
  if (!entry || !isInlineTokenProvider(entry)) throw new Error("This integration cannot be configured here.");
  const { config, secret, existing } = await parseTokenValues(input.projectId, entry, input.values);
  let message: string | null = null;
  if (input.test && entry.testable) message = await testTokenCredentials(entry.key, config, secret, { projectDomain: input.projectDomain });
  // Even untested saves may not point the instance-wide Bing key at a foreign site.
  if (entry.key === PROVIDERS.bing && !secret.apiKey && !bingSiteMatchesDomain(config.siteUrl ?? "", input.projectDomain))
    throw new Error(`Without your own API key, only sites on ${input.projectDomain} can be connected.`);
  // Credentials that point somewhere else invalidate synced data.
  const prev = existing?.config ?? {};
  const changedTarget =
    !!existing &&
    ((entry.key === PROVIDERS.bing && prev.siteUrl !== config.siteUrl) ||
      (entry.key === PROVIDERS.matomo && (prev.url !== config.url || String(prev.siteId) !== config.siteId)) ||
      (entry.key === PROVIDERS.piwik && (prev.accountUrl !== config.accountUrl || prev.websiteId !== config.websiteId)));
  if (changedTarget) await cancelAnalyticsSync(input.projectId, entry.key);
  const row = await db.transaction(async (tx) => {
    await lockSyncTarget(tx, input.projectId, entry.key);
    if (changedTarget) await deleteSyncedData(input.projectId, entry.key, tx);
    return saveIntegration(
      {
        projectId: input.projectId,
        provider: entry.key,
        status: "connected",
        config: {
          ...config,
          connectedAt: (prev.connectedAt as string | undefined) ?? new Date().toISOString(),
          syncedThrough: changedTarget ? null : (prev.syncedThrough ?? null),
          ...(entry.key === PROVIDERS.bing ? { backfilledFrom: changedTarget ? null : (prev.backfilledFrom ?? null) } : {}),
        },
        secret: Object.keys(secret).length ? secret : null,
        connectedBy: existing?.connectedBy ?? input.userId,
        lastError: null,
      },
      tx,
    );
  });
  await enqueueAnalyticsSync(input.projectId, entry.key, { full: !existing || changedTarget, createdBy: input.userId, priority: 20 });
  return { integration: toPublicIntegration(row), message };
}

/** Values to prefill the token dialog (secrets are never returned — only whether they are set). */
export async function getTokenFormState(projectId: string, provider: string) {
  const row = await getIntegration(projectId, provider);
  const entry = getCatalogEntry(provider);
  if (!row || !entry) return { values: {} as Record<string, string>, secretsSet: {} as Record<string, boolean> };
  const secret = readSecret<Record<string, string>>(row) ?? {};
  const values: Record<string, string> = {};
  const secretsSet: Record<string, boolean> = {};
  for (const f of entry.fields ?? []) {
    if (f.secret) secretsSet[f.key] = !!secret[f.key];
    else if (row.config[f.key] != null) values[f.key] = String(row.config[f.key]);
  }
  return { values, secretsSet };
}
