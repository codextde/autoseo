import "server-only";
import { z } from "zod";
import {
  getCachedInspection,
  getInspectionQuota,
  inspectUrl,
  listRecentInspections,
} from "@/server/analytics/search-console/inspection";
import type { ApiPrincipal, ApiProject } from "./auth";
import { ApiError } from "./errors";

/**
 * Google Search Console URL Inspection via REST v1 / MCP. Reading a result from the last 24 h is
 * open to anyone with project access; a live inspection uses the property's daily Google quota
 * (2,000/day, 600/min), so — like the app — it needs "Run paid SEO research" or "Integrations".
 */
export const inspectUrlInput = z.object({
  url: z.string().trim().min(8).max(2048).describe("Absolute URL of a page in the project's Search Console property."),
  force: z.boolean().optional().describe("Re-inspect even when a result from the last 24 h exists (uses quota)."),
  languageCode: z.string().trim().max(20).optional().describe("BCP-47 language for Google's messages, e.g. en-US."),
});

export function canInspectLive(p: ApiPrincipal) {
  return p.permissions.has("seo.run") || p.permissions.has("settings.manage");
}

export async function inspectUrlForApi(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof inspectUrlInput>) {
  const input = inspectUrlInput.parse(raw);
  if (!canInspectLive(p)) {
    const cached = await getCachedInspection(project.id, input.url);
    if (cached && !input.force) return cached;
    throw new ApiError(
      "forbidden",
      "This URL has no inspection from the last 24 hours, and a live inspection needs the “Run paid SEO research” or “Integrations” permission (it uses the property's daily Google quota).",
      { requiredPermission: "seo.run" },
    );
  }
  return inspectUrl({ projectId: project.id, url: input.url, force: input.force, languageCode: input.languageCode ?? null, userId: p.user.id });
}

export const inspectionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function recentInspectionsForApi(project: ApiProject, limit: number) {
  const [items, quota] = await Promise.all([listRecentInspections(project.id, limit), getInspectionQuota(project.id)]);
  return { items, quota };
}
