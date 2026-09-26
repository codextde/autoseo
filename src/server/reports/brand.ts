import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, reportBrandKits, workspaces, type BrandKitData } from "@/server/db/schema";
import type { BrandKit } from "@/features/reports/lib/theme";

export type ResolvedBrandKit = {
  /** Workspace (agency) kit as stored (without project overrides). */
  workspace: BrandKit;
  /** Client overrides for the project as stored. */
  client: BrandKit;
  /** Effective kit: defaults ← workspace ← client. */
  effective: BrandKit;
};

const clean = (kit: BrandKitData | null | undefined): BrandKit => {
  const out: BrandKit = {};
  for (const [k, v] of Object.entries(kit ?? {})) if (v !== undefined && v !== null && v !== "") (out as Record<string, unknown>)[k] = v;
  return out;
};

/** Loads the agency + client brand kit for a project (falls back to workspace branding & project data). */
export async function getBrandKit(workspaceId: string, projectId: string): Promise<ResolvedBrandKit> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const rows = await db
    .select()
    .from(reportBrandKits)
    .where(and(eq(reportBrandKits.workspaceId, workspaceId), inArray(reportBrandKits.scope, ["workspace", projectId])));
  const workspace = clean(rows.find((r) => r.scope === "workspace")?.data);
  const client = clean(rows.find((r) => r.scope === projectId)?.data);
  const branding = ws?.branding ?? {};
  const defaults: BrandKit = {
    agencyName: branding.agencyName || ws?.name || "",
    agencyLogo: branding.logoUrl || ws?.logoUrl || undefined,
    accentColor: branding.accentColor || undefined,
    clientName: project?.name,
    clientLogo: project?.logoUrl || undefined,
  };
  const effective: BrandKit = { ...clean(defaults as BrandKitData), ...workspace, ...client };
  return { workspace, client, effective };
}

export async function saveBrandKit(workspaceId: string, scope: string, data: BrandKit, userId: string) {
  const payload = clean(data as BrandKitData) as BrandKitData;
  await db
    .insert(reportBrandKits)
    .values({ workspaceId, scope, data: payload, updatedBy: userId })
    .onConflictDoUpdate({
      target: [reportBrandKits.workspaceId, reportBrandKits.scope],
      set: { data: payload, updatedBy: userId, updatedAt: new Date() },
    });
}
