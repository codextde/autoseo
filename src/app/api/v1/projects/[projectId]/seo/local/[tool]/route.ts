import { z } from "zod";
import { getApiProject } from "@/server/api/auth";
import { ApiError } from "@/server/api/errors";
import { apiRoute, parseBody } from "@/server/api/handler";
import { apiSeoContext } from "@/server/api/module-context";
import { LOCAL_TOOL_SLUGS, startLocalRun } from "@/server/api/seo-tracking";
import { corsPreflight } from "@/server/api/urls";

const waitSeconds = z.coerce.number().int().min(0).max(25).default(10);

/**
 * POST …/seo/local/{tool} — start a paid local SEO run (DataForSEO). tool: business-search, local-serp,
 * rank-grid, business-profile, reviews, questions, posts. Body = tool input (+ waitSeconds 0–25, default 10).
 * 200 with the result when finished in time, else 202 — poll GET …/seo/local/runs/{runId} (free).
 */
export const POST = apiRoute<{ projectId: string; tool: string }>({ scope: "read", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const tool = LOCAL_TOOL_SLUGS[params.tool];
  if (!tool) throw new ApiError("not_found", `Unknown local SEO tool "${params.tool}". Use one of: ${Object.keys(LOCAL_TOOL_SLUGS).join(", ")}.`);
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, z.record(z.string(), z.unknown()));
  const wait = waitSeconds.parse(body.waitSeconds);
  delete body.waitSeconds;
  const run = await startLocalRun(apiSeoContext(principal, project), tool, body as never, wait * 1000);
  return { status: run.status === "completed" || run.status === "failed" ? 200 : 202, data: run };
});

export const OPTIONS = corsPreflight;
