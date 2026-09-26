import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, type ProjectBrand } from "@/server/db/schema";
import { competitors, prompts, promptTags, promptTagLinks } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { enqueueJob } from "@/server/jobs/queue";
import { logAudit } from "@/server/audit";
import { getCountry } from "@/lib/countries";

export function normalizeDomain(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
  }
}

export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

export type CreateProjectInput = {
  workspaceId: string;
  name: string;
  domain: string;
  country?: string;
  language?: string;
  description?: string | null;
  logoUrl?: string | null;
  brand?: Partial<ProjectBrand>;
  engines?: string[];
  trackingFrequency?: "daily" | "weekly" | "monthly" | "paused";
  isPitch?: boolean;
  pitchDays?: number;
  competitors?: { name: string; domain?: string | null }[];
  prompts?: { text: string; topic?: string | null; funnelStage?: "tofu" | "mofu" | "bofu" | null; branded?: boolean; tags?: string[] }[];
  createdBy?: { id: string; email: string } | null;
  /** Kick off background bootstrap (brand knowledge, first tracking run). Default true. */
  bootstrap?: boolean;
};

export async function createProject(input: CreateProjectInput) {
  const limits = await getSetting("limits");
  const onboarding = await getSetting("onboarding");
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.archived, false)));
  if (n >= limits.maxProjectsPerWorkspace) throw new Error(`Project limit reached (${limits.maxProjectsPerWorkspace}).`);

  const domain = normalizeDomain(input.domain);
  if (!isValidDomain(domain)) throw new Error("Please enter a valid domain, e.g. example.com");
  const country = (input.country ?? onboarding.defaultCountry).toUpperCase();
  const language = input.language ?? getCountry(country)?.language ?? onboarding.defaultLanguage;

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: input.workspaceId,
      name: input.name.trim() || domain,
      domain,
      websiteUrl: `https://${domain}`,
      description: input.description ?? null,
      logoUrl: input.logoUrl ?? null,
      country,
      language,
      brand: { aliases: input.brand?.aliases ?? [], domains: input.brand?.domains ?? [], description: input.brand?.description, industry: input.brand?.industry },
      engines: input.engines?.length ? input.engines : onboarding.defaultEngines,
      trackingFrequency: input.trackingFrequency ?? onboarding.defaultTrackingFrequency,
      isPitch: input.isPitch ?? false,
      pitchExpiresAt: input.isPitch ? new Date(Date.now() + (input.pitchDays ?? 30) * 86400000) : null,
      createdBy: input.createdBy?.id ?? null,
    })
    .returning();

  for (const c of input.competitors ?? []) {
    if (!c.name.trim()) continue;
    await db
      .insert(competitors)
      .values({ projectId: project!.id, name: c.name.trim(), domain: c.domain ? normalizeDomain(c.domain) : null, source: "manual" })
      .onConflictDoNothing();
  }

  const tagIds = new Map<string, string>();
  for (const p of input.prompts ?? []) {
    if (!p.text.trim()) continue;
    const [row] = await db
      .insert(prompts)
      .values({
        projectId: project!.id,
        text: p.text.trim(),
        country,
        language,
        topic: p.topic ?? null,
        funnelStage: p.funnelStage ?? null,
        branded: p.branded ?? false,
        source: "generated",
        createdBy: input.createdBy?.id ?? null,
      })
      .returning();
    for (const tag of p.tags ?? (p.topic ? [p.topic] : [])) {
      let tagId = tagIds.get(tag);
      if (!tagId) {
        const [t] = await db
          .insert(promptTags)
          .values({ projectId: project!.id, name: tag })
          .onConflictDoUpdate({ target: [promptTags.projectId, promptTags.name], set: { name: tag } })
          .returning();
        tagId = t!.id;
        tagIds.set(tag, tagId);
      }
      await db.insert(promptTagLinks).values({ promptId: row!.id, tagId }).onConflictDoNothing();
    }
  }

  if (input.bootstrap !== false) {
    await enqueueJob(
      "ai.project_bootstrap",
      { projectId: project!.id, userId: input.createdBy?.id ?? null },
      { projectId: project!.id, workspaceId: project!.workspaceId, dedupeKey: `bootstrap:${project!.id}` },
    );
  }
  void logAudit("project.created", {
    actor: input.createdBy ?? null,
    targetType: "project",
    targetId: project!.id,
    workspaceId: input.workspaceId,
    projectId: project!.id,
    meta: { domain },
  });
  return project!;
}
