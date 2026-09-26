"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { getCatalogEntry, PROVIDERS } from "@/lib/integrations-catalog";
import {
  disconnectIntegration,
  getTokenFormState,
  googleAccountRemovalImpact,
  listGoogleProperties,
  removeGoogleAccount,
  parseTokenValues,
  saveTokenIntegration,
  selectGoogleProperty,
  testTokenCredentials,
} from "@/server/integrations/service";
import { getGoogleAccount } from "@/server/integrations/google/accounts";
import { exportRowsToGoogleSheet } from "@/server/integrations/google/sheets-export";
import { SheetExportLimitError } from "@/server/integrations/google/sheets";
import { getIntegration, issueIngestToken } from "@/server/integrations/store";
import { enqueueAnalyticsSync } from "@/server/analytics/scheduling";

const projectIdSchema = z.string().min(3).max(64);
const productSchema = z.enum(["gsc", "ga4"]);
const accountIdSchema = z.string().regex(/^gac_[a-z0-9]{16}$/);
const providerSchema = z.string().min(2).max(64).regex(/^[a-z0-9_]+$/);

function revalidateProject(projectId: string) {
  revalidatePath(`/p/${projectId}/integrations`);
  revalidatePath(`/p/${projectId}/analytics`, "layout");
}

export async function listGooglePropertiesAction(projectId: string, product: "gsc" | "ga4", accountId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    return listGoogleProperties(ctx.project.id, productSchema.parse(product), ctx.project.domain, accountIdSchema.parse(accountId));
  });
}

export async function selectGooglePropertyAction(projectId: string, product: "gsc" | "ga4", accountId: string, propertyId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const p = productSchema.parse(product);
    const id = z.string().min(3).max(500).parse(propertyId);
    const result = await selectGoogleProperty({
      projectId: ctx.project.id,
      product: p,
      accountId: accountIdSchema.parse(accountId),
      propertyId: id,
      projectDomain: ctx.project.domain,
      userId: ctx.user.id,
    });
    await logAudit("integration.property_select", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: p === "gsc" ? PROVIDERS.gsc : PROVIDERS.ga4,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      meta: { propertyId: id, googleAccountId: accountId },
    });
    revalidateProject(ctx.project.id);
    return result;
  });
}

/** Which project connections (and their data) are removed together with a Google account. */
export async function googleAccountImpactAction(projectId: string, accountId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const account = await getGoogleAccount(accountIdSchema.parse(accountId), ctx.project.workspaceId);
    if (!account) throw new ActionError("Google account not found.", "not_found");
    if (!ctx.permissions.has("settings.manage") && account.connectedBy !== ctx.user.id)
      throw new ActionError("You don't have permission to do this.", "forbidden");
    return googleAccountRemovalImpact(ctx.project.workspaceId, account.id);
  });
}

/**
 * Removes a linked Google account from the workspace (disconnecting the project connections that
 * use it). Admins (settings.manage) may remove any account; members only accounts they linked
 * themselves that no project connection uses (e.g. their Sheets export account).
 */
export async function removeGoogleAccountAction(projectId: string, accountId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const account = await getGoogleAccount(accountIdSchema.parse(accountId), ctx.project.workspaceId);
    if (!account) throw new ActionError("Google account not found.", "not_found");
    const impact = await googleAccountRemovalImpact(ctx.project.workspaceId, account.id);
    const isAdmin = ctx.permissions.has("settings.manage") || ctx.isInstanceAdmin;
    if (!isAdmin && (account.connectedBy !== ctx.user.id || impact.integrations.length > 0))
      throw new ActionError("Only workspace admins can remove Google accounts that projects use.", "forbidden");
    await removeGoogleAccount(ctx.project.workspaceId, account.id);
    await logAudit("integration.google_account_remove", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "google_account",
      targetId: account.id,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      meta: { email: account.email, disconnected: impact.integrations.map((i) => `${i.projectId}:${i.provider}`) },
    });
    for (const i of impact.integrations) revalidateProject(i.projectId);
    revalidateProject(ctx.project.id);
    return { removed: impact.integrations.length };
  });
}

const sheetCell = z.union([z.string().max(50_000), z.number(), z.boolean(), z.null()]);
const sheetExportSchema = z.object({
  projectId: projectIdSchema,
  title: z.string().trim().min(1).max(200),
  headers: z.array(z.string().max(500)).min(1).max(500),
  rows: z.array(z.array(sheetCell).max(500)).max(200_000),
});

/** Creates a Google Sheet (bold, frozen header row) from table rows and returns its URL. */
export async function exportRowsToGoogleSheetAction(input: {
  projectId: string;
  title: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
}) {
  return runAction(async () => {
    const data = sheetExportSchema.parse(input);
    const ctx = await actionProject(data.projectId);
    try {
      const result = await exportRowsToGoogleSheet({
        workspaceId: ctx.project.workspaceId,
        userId: ctx.user.id,
        title: data.title,
        headers: data.headers,
        rows: data.rows,
      });
      if (result.status === "created") {
        await logAudit("export.google_sheets", {
          actor: { id: ctx.user.id, email: ctx.user.email },
          targetType: "project",
          targetId: ctx.project.id,
          workspaceId: ctx.project.workspaceId,
          projectId: ctx.project.id,
          meta: { title: data.title, rows: result.rows },
        });
      }
      return result;
    } catch (err) {
      if (err instanceof SheetExportLimitError) throw new ActionError(err.message, "invalid");
      throw err;
    }
  });
}

export async function disconnectIntegrationAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const key = providerSchema.parse(provider);
    const entry = getCatalogEntry(key);
    if (!entry || entry.setupHref?.startsWith("/settings") || (entry.setupHref && !entry.setupHref.includes("/analytics/")))
      throw new ActionError("This integration is managed on its own page.", "invalid");
    const removed = await disconnectIntegration(ctx.project.id, key);
    if (!removed) throw new ActionError("Not connected.", "not_found");
    await logAudit("integration.disconnect", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: key,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
    });
    revalidateProject(ctx.project.id);
    return true;
  });
}

export async function syncIntegrationAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const key = providerSchema.parse(provider);
    const row = await getIntegration(ctx.project.id, key);
    if (!row) throw new ActionError("Not connected.", "not_found");
    if (row.status === "pending") throw new ActionError("Select a property first.", "invalid");
    const job = await enqueueAnalyticsSync(ctx.project.id, key, { createdBy: ctx.user.id, priority: 10 });
    return { jobId: job?.id ?? null, alreadyQueued: !job };
  });
}

export async function getTokenFormStateAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    return getTokenFormState(ctx.project.id, providerSchema.parse(provider));
  });
}

const valuesSchema = z.record(z.string(), z.string().max(2000));

export async function testTokenIntegrationAction(projectId: string, provider: string, values: Record<string, string>) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const entry = getCatalogEntry(providerSchema.parse(provider));
    if (!entry?.testable) throw new ActionError("This integration cannot be tested.", "invalid");
    const parsed = await parseTokenValues(ctx.project.id, entry, valuesSchema.parse(values)).catch((err: Error) => {
      throw new ActionError(err.message, "invalid");
    });
    try {
      return await testTokenCredentials(entry.key, parsed.config, parsed.secret, { projectDomain: ctx.project.domain });
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : "Connection test failed", "invalid");
    }
  });
}

export async function saveTokenIntegrationAction(
  projectId: string,
  provider: string,
  values: Record<string, string>,
  opts: { test?: boolean } = {},
) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const key = providerSchema.parse(provider);
    let result;
    try {
      result = await saveTokenIntegration({
        projectId: ctx.project.id,
        projectDomain: ctx.project.domain,
        provider: key,
        values: valuesSchema.parse(values),
        userId: ctx.user.id,
        test: opts.test !== false,
      });
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : "Could not save", "invalid");
    }
    await logAudit("integration.connect", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: key,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
    });
    revalidateProject(ctx.project.id);
    return result;
  });
}

/** Creates or rotates an ingest token (server logs, Cloudflare, Akamai). The plain token is returned once. */
export async function issueIngestTokenAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "settings.manage");
    const key = providerSchema.parse(provider);
    if (![PROVIDERS.serverLogs, PROVIDERS.cloudflare, PROVIDERS.akamai].includes(key as never))
      throw new ActionError("Unsupported provider.", "invalid");
    const existing = await getIntegration(ctx.project.id, key);
    const res = await issueIngestToken({ projectId: ctx.project.id, provider: key, connectedBy: ctx.user.id });
    await logAudit(existing?.tokenHash ? "integration.token_rotate" : "integration.token_create", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "integration",
      targetId: key,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      meta: { prefix: res.prefix },
    });
    revalidateProject(ctx.project.id);
    return { token: res.token, prefix: res.prefix };
  });
}
