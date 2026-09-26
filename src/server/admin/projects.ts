import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projectMembers, projects, workspaceMembers, workspaces, users } from "@/server/db/schema";
import { isValidDomain, normalizeDomain } from "@/server/projects";
import { logAudit } from "@/server/audit";
import { getCountry, LANGUAGES } from "@/lib/countries";
import { ENGINES } from "@/lib/engines";
import { deleteUploadByUrl, isSafeImageUrl } from "./uploads";

type Actor = { id: string; email: string };

export class ProjectAdminError extends Error {}

const ENGINE_IDS = ENGINES.map((e) => e.id) as [string, ...string[]];
const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

/** Editable project fields (general, brand, tracking). All optional — only given fields change. */
export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    domain: z.string().trim().min(1).max(253),
    logoUrl: z.string().trim().max(2000).nullable(),
    description: z.string().trim().max(2000).nullable(),
    country: z.string().trim().min(2).max(3),
    language: z.string().trim().min(2).max(8),
    brand: z.object({
      aliases: z.array(z.string().trim().min(1).max(120)).max(50),
      domains: z.array(z.string().trim().min(1).max(253)).max(50),
      description: z.string().trim().max(2000).optional(),
      industry: z.string().trim().max(200).optional(),
    }),
    engines: z.array(z.enum(ENGINE_IDS)).min(1, "Enable at least one AI engine").max(ENGINE_IDS.length),
    trackingFrequency: z.enum(["daily", "weekly", "monthly", "paused"]),
  })
  .partial();

export type ProjectPatch = z.input<typeof projectPatchSchema>;

export async function getProject(projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new ProjectAdminError("Project not found.");
  return p;
}

/** Validates and applies a project patch; writes an audit entry with the changed fields. */
export async function updateProject(
  projectId: string,
  rawPatch: ProjectPatch,
  actor: Actor,
  opts: { uploadedLogoUrl?: string } = {},
) {
  const patch = projectPatchSchema.parse(rawPatch);
  const current = await getProject(projectId);
  const set: Partial<typeof projects.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.domain !== undefined) {
    const d = normalizeDomain(patch.domain);
    if (!isValidDomain(d)) throw new ProjectAdminError("Please enter a valid domain, e.g. example.com");
    set.domain = d;
    set.websiteUrl = `https://${d}`;
  }
  if (patch.logoUrl !== undefined) {
    const url = patch.logoUrl || null;
    // Local upload URLs are only accepted from the upload action itself (or unchanged), so nobody
    // can point a project at — and later delete — another project's logo or a user's avatar.
    const isLocal = Boolean(url?.startsWith("/"));
    if (url && isLocal && url !== current.logoUrl && url !== opts.uploadedLogoUrl) {
      throw new ProjectAdminError("Upload the logo file instead of pasting an internal URL.");
    }
    if (url && !isSafeImageUrl(url, isLocal ? "logos" : undefined)) throw new ProjectAdminError("Logo must be an uploaded image or an http(s) URL.");
    set.logoUrl = url;
  }
  if (patch.description !== undefined) set.description = patch.description || null;
  if (patch.country !== undefined) {
    const c = getCountry(patch.country);
    if (!c) throw new ProjectAdminError("Unknown market.");
    set.country = c.iso;
  }
  if (patch.language !== undefined) {
    if (!LANGUAGE_CODES.has(patch.language)) throw new ProjectAdminError("Unknown language.");
    set.language = patch.language;
  }
  if (patch.brand !== undefined) {
    const domains: string[] = [];
    for (const raw of patch.brand.domains) {
      const d = normalizeDomain(raw);
      if (!isValidDomain(d)) throw new ProjectAdminError(`"${raw}" is not a valid domain.`);
      if (!domains.includes(d)) domains.push(d);
    }
    set.brand = {
      ...current.brand,
      aliases: [...new Set(patch.brand.aliases)],
      domains,
      description: patch.brand.description ?? current.brand.description,
      industry: patch.brand.industry ?? current.brand.industry,
    };
  }
  if (patch.engines !== undefined) set.engines = [...new Set(patch.engines)];
  if (patch.trackingFrequency !== undefined) set.trackingFrequency = patch.trackingFrequency;
  if (Object.keys(set).length === 0) return current;

  const [updated] = await db.update(projects).set(set).where(eq(projects.id, projectId)).returning();
  if (set.logoUrl !== undefined && current.logoUrl && current.logoUrl !== set.logoUrl) await deleteUploadByUrl(current.logoUrl, "logos");
  void logAudit("project.updated", {
    actor,
    targetType: "project",
    targetId: projectId,
    projectId,
    workspaceId: current.workspaceId,
    meta: { fields: Object.keys(set) },
  });
  return updated!;
}

export async function setProjectArchived(projectId: string, archived: boolean, actor: Actor) {
  const p = await getProject(projectId);
  await db.update(projects).set({ archived }).where(eq(projects.id, projectId));
  void logAudit(archived ? "project.archived" : "project.restored", {
    actor,
    targetType: "project",
    targetId: projectId,
    projectId,
    workspaceId: p.workspaceId,
  });
}

/** Permanently deletes a project and all of its data (cascading foreign keys). */
export async function deleteProject(projectId: string, actor: Actor) {
  const p = await getProject(projectId);
  await db.delete(projects).where(eq(projects.id, projectId));
  await deleteUploadByUrl(p.logoUrl, "logos");
  // Users who had this as their last project get redirected to another one on next visit.
  await db.update(users).set({ lastProjectId: null }).where(eq(users.lastProjectId, projectId));
  void logAudit("project.deleted", {
    actor,
    targetType: "project",
    targetId: projectId,
    workspaceId: p.workspaceId,
    meta: { name: p.name, domain: p.domain },
  });
}

/** Moves a project to another workspace; explicit access of users outside the target is dropped. */
export async function moveProject(projectId: string, targetWorkspaceId: string, actor: Actor) {
  const p = await getProject(projectId);
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, targetWorkspaceId)).limit(1);
  if (!ws) throw new ProjectAdminError("Target workspace not found.");
  if (p.workspaceId === ws.id) return;
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ workspaceId: ws.id }).where(eq(projects.id, projectId));
    const targetMembers = tx
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ws.id));
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), notInArray(projectMembers.userId, targetMembers)));
  });
  void logAudit("project.moved", {
    actor,
    targetType: "project",
    targetId: projectId,
    projectId,
    workspaceId: ws.id,
    meta: { from: p.workspaceId, to: ws.id },
  });
}

/** Turns a project into a pitch project (expires) or back into a regular project. */
export async function setProjectPitch(projectId: string, opts: { isPitch: boolean; days?: number | null; expiresAt?: Date | null }, actor: Actor) {
  const p = await getProject(projectId);
  const expiresAt = opts.isPitch
    ? (opts.expiresAt ?? new Date(Date.now() + Math.max(1, Math.min(365, opts.days ?? 30)) * 86_400_000))
    : null;
  await db.update(projects).set({ isPitch: opts.isPitch, pitchExpiresAt: expiresAt }).where(eq(projects.id, projectId));
  void logAudit(opts.isPitch ? "project.pitch_set" : "project.pitch_converted", {
    actor,
    targetType: "project",
    targetId: projectId,
    projectId,
    workspaceId: p.workspaceId,
    meta: { expiresAt: expiresAt?.toISOString() ?? null },
  });
  return expiresAt;
}

/** Project counts per workspace (for admin lists). */
export async function projectCountsByWorkspace(workspaceIds: string[]) {
  if (!workspaceIds.length) return new Map<string, { active: number; archived: number }>();
  const rows = await db
    .select({
      workspaceId: projects.workspaceId,
      active: sql<number>`count(*) filter (where not ${projects.archived})::int`,
      archived: sql<number>`count(*) filter (where ${projects.archived})::int`,
    })
    .from(projects)
    .where(inArray(projects.workspaceId, workspaceIds))
    .groupBy(projects.workspaceId);
  return new Map(rows.map((r) => [r.workspaceId, { active: Number(r.active), archived: Number(r.archived) }]));
}
