import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations } from "@/server/db/schema";
import { getIntegration, readSecret, type IntegrationRow } from "@/server/integrations";
import { PROVIDER_LABELS } from "@/features/optimize/constants";
import { CMS_PROVIDERS, OPTIMIZE_PROVIDER_KEYS, PM_PROVIDERS, getProviderMeta } from "./registry";
import type { ConnectedIntegration } from "./types";
import type { Creds, Target } from "./providers/common";

export type { IntegrationRow };

/** Non-secret config we keep in `integrations.config` for optimize providers. */
export type OptimizeIntegrationConfig = {
  kind: "pm" | "cms";
  account: string | null;
  target: { id: string; name: string } | null;
  /** Non-secret field values (site URL, email, shop domain…) */
  fields: Record<string, string>;
};

export function readConfig(row: IntegrationRow): OptimizeIntegrationConfig {
  const c = (row.config ?? {}) as Partial<OptimizeIntegrationConfig>;
  const meta = getProviderMeta(row.provider);
  return {
    kind: c.kind ?? meta?.kind ?? "pm",
    account: typeof c.account === "string" ? c.account : null,
    target: c.target && typeof c.target === "object" && typeof c.target.id === "string" ? c.target : null,
    fields: c.fields && typeof c.fields === "object" ? (c.fields as Record<string, string>) : {},
  };
}

export function readSecrets(row: IntegrationRow): Record<string, string> {
  return readSecret<Record<string, string>>(row) ?? {};
}

/** Field values + secrets merged — input for the provider client. */
export function readCreds(row: IntegrationRow): Creds {
  return { ...readConfig(row).fields, ...readSecrets(row) };
}

export function readTarget(row: IntegrationRow): Target {
  return readConfig(row).target;
}

export function toConnected(row: IntegrationRow): ConnectedIntegration {
  const cfg = readConfig(row);
  const meta = getProviderMeta(row.provider);
  return {
    id: row.id,
    provider: row.provider,
    name: meta?.name ?? PROVIDER_LABELS[row.provider] ?? row.provider,
    kind: cfg.kind,
    status: row.status,
    account: cfg.account,
    target: cfg.target,
    lastError: row.lastError,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
  };
}

export async function getIntegrationRow(projectId: string, provider: string): Promise<IntegrationRow | null> {
  return getIntegration(projectId, provider);
}

export async function listIntegrationRows(projectId: string, kind?: "pm" | "cms"): Promise<IntegrationRow[]> {
  const keys = kind === "pm" ? PM_PROVIDERS.map((p) => p.key) : kind === "cms" ? CMS_PROVIDERS.map((p) => p.key) : OPTIMIZE_PROVIDER_KEYS;
  return db
    .select()
    .from(integrations)
    .where(and(eq(integrations.projectId, projectId), inArray(integrations.provider, keys)));
}
