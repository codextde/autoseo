"use server";

import { z } from "zod";
import { createLocalRun, deleteLocalRun, geocodePlace, getLocalRun, listBusinessCategories, listLocalRuns, retryLocalCollect, type LocalRunTool } from "@/server/seo";
import { LOCAL_TOOL_SCHEMAS, type LocalToolInput } from "@/server/seo/local";
import { SEO_LOCAL_TOOLS } from "@/server/db/schema";
import { seoAction } from "../server/action-helpers";

const toolSchema = z.enum(Object.keys(LOCAL_TOOL_SCHEMAS) as [LocalRunTool, ...LocalRunTool[]]);

export async function createLocalRunAction<T extends LocalRunTool>(projectId: string, tool: T, input: LocalToolInput<T>) {
  return seoAction(projectId, "seo.run", async (ctx) => {
    const run = await createLocalRun(ctx, toolSchema.parse(tool) as T, input);
    return { id: run.id, status: run.status };
  });
}

export async function getLocalRunAction(projectId: string, runId: string) {
  return seoAction(projectId, undefined, (ctx) => getLocalRun(ctx, z.string().parse(runId)));
}

export async function listLocalRunsAction(projectId: string, tool?: string) {
  return seoAction(projectId, undefined, (ctx) => listLocalRuns(ctx, { tool: tool ? z.enum(SEO_LOCAL_TOOLS).parse(tool) : undefined }));
}

export async function deleteLocalRunAction(projectId: string, runId: string) {
  return seoAction(projectId, "seo.run", (ctx) => deleteLocalRun(ctx, runId));
}

export async function retryLocalCollectAction(projectId: string, runId: string) {
  return seoAction(projectId, "seo.run", (ctx) => retryLocalCollect(ctx, runId));
}

/** Free (DataForSEO categories endpoint, cached 7 days). */
export async function listBusinessCategoriesAction(projectId: string, query: string) {
  return seoAction(projectId, undefined, (ctx) => listBusinessCategories(ctx, { query, limit: 30 }));
}

/** Place → coordinates (OpenStreetMap Nominatim, rate limited, cached). */
export async function geocodePlaceAction(projectId: string, query: string) {
  return seoAction(projectId, undefined, () => geocodePlace(query));
}
