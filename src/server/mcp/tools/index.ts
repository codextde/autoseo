import "server-only";
import type { McpTool } from "../types";
import { accountTools } from "./account";
import { contextTools } from "./context";
import { aiVisibilityTools } from "./ai-visibility";
import { taskTools } from "./tasks";
import { seoResearchTools } from "./seo-research";
import { seoTrackingTools } from "./seo-tracking";
import { auditTools } from "./audit";
import { analyticsTools } from "./analytics";
import { researchTools } from "./research";
import { optimizeTools } from "./optimize";
import { reportsTools } from "./reports";

/**
 * MCP tool registry. Each domain lives in its own file (`tools/<domain>.ts`) exporting an array
 * of `defineTool(...)` entries — add a domain by importing it and adding a group here.
 */
export const MCP_TOOL_GROUPS: { id: string; label: string; tools: McpTool[] }[] = (
  [
    { id: "account", label: "Account & projects", tools: accountTools },
    { id: "context", label: "Project context", tools: contextTools },
    { id: "ai-visibility", label: "AI visibility", tools: aiVisibilityTools },
    { id: "tasks", label: "Optimization tasks", tools: taskTools },
    { id: "seo-research", label: "Keywords, SERP, domains & backlinks", tools: seoResearchTools },
    { id: "seo-tracking", label: "Rank tracking & local SEO", tools: seoTrackingTools },
    { id: "audit", label: "Site audit & crawlability", tools: auditTools },
    { id: "analytics", label: "Search Console & Google Analytics", tools: analyticsTools },
    { id: "research", label: "AI research", tools: researchTools },
    { id: "optimize", label: "Content, fact check & attribution", tools: optimizeTools },
    { id: "reports", label: "Reports", tools: reportsTools },
  ] as unknown as { id: string; label: string; tools: McpTool[] }[]
).filter((g) => g.tools.length > 0);

export const MCP_TOOLS: McpTool[] = MCP_TOOL_GROUPS.flatMap((g) => g.tools);

/**
 * Tools that can incur cost — DataForSEO calls, AI generation (LLM API fallback) or AI tracking
 * runs. They additionally require the credential's "spend" scope (on top of `scope` and the role
 * permission). Kept as one explicit, auditable list; a unit test checks every name exists.
 */
export const SPEND_TOOL_NAMES = [
  // Project / prompt setup that starts AI tracking runs or LLM bootstrap
  "create_project",
  "add_prompts",
  "add_research_prompts_to_tracker",
  // DataForSEO keyword, SERP, domain and backlink research
  "research_keywords",
  "get_keyword_metrics",
  "get_serp_results",
  "get_domain_overview",
  "get_domain_keyword_suggestions",
  "get_ranked_keywords",
  "get_domain_top_pages",
  "find_serp_competitors",
  "get_backlinks_overview",
  "get_backlinks_profile",
  "get_referring_domains",
  "get_backlinks_top_pages",
  // Rank tracking (scheduled trackers and added keywords create recurring checks)
  "create_rank_tracker",
  "add_rank_tracking_keywords",
  "run_rank_tracker",
  // Local SEO (DataForSEO business data / Maps SERP)
  "search_local_businesses",
  "get_local_serp_results",
  "get_google_business_questions",
  "get_business_profile",
  "get_business_reviews",
  "get_business_updates",
  "get_local_rank_grid",
  // Audits (Lighthouse via DataForSEO) and AI crawlability analysis
  "run_site_audit",
  "run_crawlability_check",
  // AI research and generation
  "run_brand_lookup",
  "run_prompt_explorer",
  "generate_prompt_research",
  "generate_content",
  "optimize_page_content",
  "run_fact_check",
  "generate_report",
] as const;

const SPEND = new Set<string>(SPEND_TOOL_NAMES);
for (const t of MCP_TOOLS) if (SPEND.has(t.name)) t.spend = true;

const byName = new Map(MCP_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): McpTool | undefined {
  return byName.get(name);
}
