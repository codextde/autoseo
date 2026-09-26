import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { createProject, isValidDomain, normalizeDomain } from "@/server/projects";
import { logAudit } from "@/server/audit";
import { getCountry } from "@/lib/countries";
import { ENGINE_IDS } from "./ai-data";
import type { ApiPrincipal, ApiProject } from "./auth";
import { ApiError } from "./errors";

const engineEnum = z.enum(ENGINE_IDS as [string, ...string[]]);
const countryCode = z
  .string()
  .length(2)
  .transform((v) => v.toUpperCase())
  .refine((v) => Boolean(getCountry(v)), "Unknown country code");

export const createProjectBody = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(3).max(255),
  country: countryCode.optional(),
  language: z.string().min(2).max(8).optional(),
  description: z.string().max(2000).optional(),
  brandAliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  engines: z.array(engineEnum).min(1).max(11).optional(),
  trackingFrequency: z.enum(["daily", "weekly", "monthly", "paused"]).optional(),
  competitors: z.array(z.object({ name: z.string().trim().min(1).max(120), domain: z.string().max(255).optional() })).max(50).optional(),
  prompts: z.array(z.object({ text: z.string().trim().min(3).max(2000), tags: z.array(z.string().max(60)).max(20).optional() })).max(200).optional(),
});

export async function createProjectFromApi(p: ApiPrincipal, body: z.infer<typeof createProjectBody>) {
  if (p.restrictedProjectIds) throw new ApiError("forbidden", "This credential is restricted to selected projects and cannot create projects.");
  try {
    return await createProject({
      workspaceId: p.workspace.id,
      name: body.name,
      domain: body.domain,
      country: body.country,
      language: body.language?.toLowerCase(),
      description: body.description ?? null,
      brand: body.brandAliases ? { aliases: body.brandAliases } : undefined,
      engines: body.engines,
      trackingFrequency: body.trackingFrequency,
      competitors: body.competitors,
      prompts: body.prompts,
      createdBy: { id: p.user.id, email: p.user.email },
    });
  } catch (err) {
    throw new ApiError("validation_error", err instanceof Error ? err.message : "Could not create project.");
  }
}

export const updateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    domain: z.string().trim().min(3).max(255),
    websiteUrl: z.url().max(2048).nullable(),
    description: z.string().max(2000).nullable(),
    country: countryCode,
    language: z.string().min(2).max(8),
    brand: z.object({
      aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
      domains: z.array(z.string().trim().min(3).max(255)).max(50).optional(),
      description: z.string().max(2000).optional(),
      industry: z.string().max(200).optional(),
    }),
    engines: z.array(engineEnum).min(1).max(11),
    trackingFrequency: z.enum(["daily", "weekly", "monthly", "paused"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

export async function updateProjectFromApi(p: ApiPrincipal, project: ApiProject, body: z.infer<typeof updateProjectBody>) {
  const set: Partial<typeof projects.$inferInsert> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.domain !== undefined) {
    const d = normalizeDomain(body.domain);
    if (!isValidDomain(d)) throw new ApiError("validation_error", "domain: please enter a valid domain, e.g. example.com");
    set.domain = d;
  }
  if (body.websiteUrl !== undefined) {
    if (body.websiteUrl && !/^https?:\/\//i.test(body.websiteUrl)) throw new ApiError("validation_error", "websiteUrl must be http(s).");
    set.websiteUrl = body.websiteUrl;
  }
  if (body.description !== undefined) set.description = body.description;
  if (body.country !== undefined) set.country = body.country;
  if (body.language !== undefined) set.language = body.language.toLowerCase();
  if (body.brand !== undefined) {
    const cur = project.brand ?? { aliases: [], domains: [] };
    set.brand = {
      aliases: body.brand.aliases ?? cur.aliases ?? [],
      domains: body.brand.domains ? body.brand.domains.map(normalizeDomain).filter(isValidDomain) : (cur.domains ?? []),
      description: body.brand.description ?? cur.description,
      industry: body.brand.industry ?? cur.industry,
    };
  }
  if (body.engines !== undefined) set.engines = [...new Set(body.engines)];
  if (body.trackingFrequency !== undefined) set.trackingFrequency = body.trackingFrequency;
  const [row] = await db.update(projects).set(set).where(eq(projects.id, project.id)).returning();
  void logAudit("project.updated", {
    actor: { id: p.user.id, email: p.user.email },
    targetType: "project",
    targetId: project.id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    meta: { via: p.kind === "oauth" ? "oauth" : "api_key", fields: Object.keys(set) },
  });
  return row!;
}
