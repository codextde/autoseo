import "server-only";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { SeoError, toSeoError } from "@/server/seo";
import type { FreeToolSlug } from "@/features/free-tools/lib/registry";
import type { ToolRunResult } from "@/features/free-tools/lib/types";
import { executeTool } from "./engine";
import { dataforseoFetcher, lookupDomainAge } from "./providers";
import { RESERVED_MICRO_USD_PER_CALL, isPaidTool } from "./spend";
import { getServerTool } from "./tools";

export type AppToolContext = {
  projectId: string;
  workspaceId: string;
  userId: string | null;
  /** `seo.run` (or instance admin) — required for the DataForSEO-backed tools. */
  canRun: boolean;
};

const SURFACED_CODES = new Set(["NOT_CONFIGURED", "BUDGET", "AUTH_FAILED", "INSUFFICIENT_FUNDS"]);

/**
 * In-app run for signed-in users (Project → SEO Tools). No public protection pipeline: costs are recorded against the
 * workspace (`usage_events`, feature `free_tools`) and the admin budget (Admin → Limits) is asserted per call, like
 * the SEO module. Shares the result cache with the public tools, so cache hits are free.
 */
export async function runToolInApp(ctx: AppToolContext, slug: string, input: unknown): Promise<ToolRunResult<unknown>> {
  const tool = getServerTool(slug);
  if (!tool) return { ok: false, error: "Unknown tool.", code: "not_found" };
  const parsed = tool.parse(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: "invalid" };

  const toolSlug = tool.slug as FreeToolSlug;
  const paid = isPaidTool(toolSlug);
  if (paid && !ctx.canRun) {
    return { ok: false, error: 'You don\'t have permission to run paid SEO research (requires "Run paid SEO research").', code: "forbidden" };
  }
  if (paid && !(await isDataForSeoConfigured())) {
    return { ok: false, error: "DataForSEO is not configured. An admin can connect it in Admin → Data Providers.", code: "not_configured" };
  }

  const perCallUsd = paid ? RESERVED_MICRO_USD_PER_CALL[toolSlug as keyof typeof RESERVED_MICRO_USD_PER_CALL] / 1_000_000 : 0;
  const outcome = await executeTool(tool, parsed.params, {
    providers: {
      dfs: dataforseoFetcher({ feature: "free_tools", projectId: ctx.projectId, workspaceId: ctx.workspaceId, userId: ctx.userId }, perCallUsd),
      rdap: lookupDomainAge,
    },
  });
  if (outcome.ok) return { ok: true, data: outcome.data };

  const mapped = outcome.cause ? toSeoError(outcome.cause) : null;
  if (mapped instanceof SeoError && SURFACED_CODES.has(mapped.code)) return { ok: false, error: mapped.message, code: mapped.code.toLowerCase() };
  return { ok: false, error: outcome.error, code: "upstream" };
}
