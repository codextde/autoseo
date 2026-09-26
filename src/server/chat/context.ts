import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors, type projects } from "@/server/db/schema";
import { getProjectContextMarkdown } from "@/server/ai/knowledge/context";
import { buildAiScope, getVisibilityMetrics, projectCounts } from "@/server/api/ai-data";
import { getBranding } from "@/server/branding";
import { getCountry } from "@/lib/countries";
import { ENGINE_MAP } from "@/lib/engines";
import { isGroup, projectNav } from "@/lib/navigation";
import type { Permission } from "@/server/auth/permissions";

type Project = typeof projects.$inferSelect;

/**
 * System prompt of the Agent chat. Split in two blocks so prompt caching works:
 * - `stable`: identical for every project and user (role, rules, style) → cached prefix.
 * - `project`: the active project, key metrics, app pages, shared project context and the user.
 */
export type ChatSystemPrompt = { stable: string; project: string };

function stablePrompt(appName: string): string {
  return [
    `You are the ${appName} Agent, the AI teammate inside ${appName} — a self-hosted platform for AI visibility (GEO/AEO: how ChatGPT, Perplexity, Google AI Overviews, AI Mode, Gemini, Claude, Copilot, Grok and others mention, rank and cite a brand) and classic SEO (keyword research, rank tracking, domain overview, backlinks, site audits, local SEO, Google Search Console and Analytics), plus optimization tasks, content, fact checks, attribution and reports.`,
    "",
    "## How you work",
    "- Look up real data with the AutoSEO tools before answering questions about the project. Never invent metrics, rankings, search volumes, URLs or quotes: every number you state must come from a tool result, the project details below, or the user.",
    "- Tools are already scoped to the active project and authenticated as the user — never ask for a project id or credentials.",
    "- Prefer a few focused tool calls; run independent lookups in parallel. Summarize what the data means instead of dumping raw tables.",
    "- Some tools call paid providers (DataForSEO, AI engines, crawls). Run focused research freely, but ask for confirmation before large or expensive batches (e.g. hundreds of keywords, full-site audits, tracking many new prompts).",
    "- Tools that change data (adding prompts, tasks, context notes, reports) act on the user's real workspace: only use them when the user asked for it or clearly agreed.",
    "- Save durable findings (business facts, goals, positioning, competitors, research conclusions) with update_project_context — a research-log entry reads `<what>: <inputs>. Verdict: <conclusion>`.",
    "- When a tool reports that something is not configured or has no data yet, say so plainly and tell the user where to fix it (e.g. Admin → Data Providers for DataForSEO, Integrations for Search Console / GA4, Admin → AI Providers or Local Agents for AI).",
    "- Link to the relevant app pages with Markdown links using the paths listed under “App pages”.",
    "",
    "## Style",
    "- Lead with the answer. Concise, friendly teammate tone; no emoji; no filler about what you are going to do.",
    "- Use Markdown: short headings, bullet lists and compact tables for comparisons. Format numbers consistently (percentages with one decimal).",
    "- Reply in the language the user writes in.",
    "",
    "## Reports",
    "When the user wants a report: if audience, period and focus are not clear, ask for them in one short message (offer sensible defaults as a numbered list). Then gather the data with tools, and create the report with the report tools when they are available; otherwise write the report in chat (executive summary, KPIs with changes, highlights, risks, next steps) and point to the Report Builder page for a branded, shareable deck.",
  ].join("\n");
}

function fmtPct(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function fmtDelta(v: number | null | undefined, suffix = " pts") {
  return v == null ? "" : ` (${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix} vs previous 30 days)`;
}

async function metricsSummary(project: Project): Promise<string> {
  try {
    const scope = await buildAiScope(project, { timeframeDays: 30 });
    const m = await getVisibilityMetrics(scope);
    const c = m.current as Record<string, number | null>;
    const ch = m.changes as Record<string, number | null>;
    if (!c.answers) return "No tracked AI answers in the last 30 days yet (prompts are answered on the tracking schedule).";
    return [
      `Last 30 days (${m.period.from} → ${m.period.to}), ${c.answers} AI answers across ${c.prompts} prompts:`,
      `- Visibility ${fmtPct(c.visibility)}${fmtDelta(ch.visibility)}`,
      `- Mention rate ${fmtPct(c.mentionRate)}${fmtDelta(ch.mentionRate)}, citation rate ${fmtPct(c.citationRate)}${fmtDelta(ch.citationRate)}`,
      `- Share of voice ${fmtPct(c.shareOfVoice)}${fmtDelta(ch.shareOfVoice)}`,
      `- Avg position ${c.avgPosition ?? "—"}, sentiment ${c.sentiment ?? "—"}/100`,
    ].join("\n");
  } catch (err) {
    console.error("[chat] metrics summary failed", err);
    return "Metrics summary unavailable right now — use the visibility tools.";
  }
}

function appPages(projectId: string): string {
  const base = `/p/${projectId}`;
  const lines: string[] = [`- Home dashboard: ${base}`];
  for (const entry of projectNav) {
    if (isGroup(entry)) for (const item of entry.items) lines.push(`- ${entry.title} → ${item.title}: ${base}${item.href}`);
    else if (entry.href) lines.push(`- ${entry.title}: ${base}${entry.href}`);
  }
  lines.push(`- Integrations: ${base}/integrations`, `- Project settings: ${base}/settings`);
  return lines.join("\n");
}

const PERMISSION_NOTES: Partial<Record<Permission, string>> = {
  "seo.run": "cannot run paid SEO research (keywords, backlinks, rank checks, audits)",
  "reports.manage": "cannot create or edit reports",
  "prompts.manage": "cannot add prompts or edit tasks, content or context",
  "attribution.manage": "cannot change attribution settings",
};

export async function buildSystemPrompt(input: {
  project: Project;
  user: { name: string | null; email: string };
  roleName: string;
  permissions: Set<Permission>;
  lockedTools: { name: string; permission: string }[];
}): Promise<ChatSystemPrompt> {
  const { project } = input;
  const [brand, comps, counts, contextMd, metrics] = await Promise.all([
    getBranding(),
    db
      .select({ name: competitors.name, domain: competitors.domain })
      .from(competitors)
      .where(and(eq(competitors.projectId, project.id), eq(competitors.tracked, true)))
      .orderBy(asc(competitors.name))
      .limit(40),
    projectCounts([project.id]),
    getProjectContextMarkdown(project.id).catch(() => "# Project context\n(unavailable)"),
    metricsSummary(project),
  ]);
  const country = getCountry(project.country);
  const engines = project.engines.map((e) => ENGINE_MAP.get(e as never)?.name ?? e).join(", ");
  const c = counts.get(project.id);
  const limits = Object.entries(PERMISSION_NOTES)
    .filter(([perm]) => !input.permissions.has(perm as Permission))
    .map(([, note]) => note);

  const project_ = [
    "# Active project",
    `- Name: ${project.name} (id ${project.id})`,
    `- Domain: ${project.domain}${project.websiteUrl ? ` — ${project.websiteUrl}` : ""}`,
    project.description ? `- Description: ${project.description.slice(0, 600)}` : null,
    project.brand?.aliases?.length ? `- Brand aliases: ${project.brand.aliases.join(", ")}` : null,
    project.brand?.industry ? `- Industry: ${project.brand.industry}` : null,
    `- Market: ${country?.name ?? project.country} (${project.country}), language ${project.language}`,
    `- Tracked AI engines: ${engines || "none"} · tracking ${project.trackingFrequency}`,
    `- Active prompts: ${c?.prompts ?? 0} · tracked competitors: ${c?.competitors ?? 0}`,
    comps.length ? `- Competitors: ${comps.map((x) => (x.domain ? `${x.name} (${x.domain})` : x.name)).join(", ")}` : "- Competitors: none tracked yet",
    "",
    "## Key metrics",
    metrics,
    "",
    "## App pages",
    appPages(project.id),
    "",
    contextMd.replace(/^# Project context/, "## Project context (shared memory — read-only here; write with update_project_context)"),
    "",
    "## User",
    `- ${input.user.name ?? input.user.email} — role ${input.roleName} in this workspace.`,
    limits.length ? `- This user ${limits.join("; ")}. The related tools are not available — explain this if asked and suggest asking a workspace admin.` : null,
    input.lockedTools.length ? `- Unavailable tools for this role: ${input.lockedTools.map((t) => t.name).join(", ")}.` : null,
    `- Today is ${new Date().toISOString().slice(0, 10)}.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { stable: stablePrompt(brand.appName), project: project_ };
}

/** Extra instructions when the answer runs on a local CLI agent (Claude Code / Codex). */
export function agentRuntimeNote(runtime: string, hasMcp: boolean): string {
  return [
    "",
    "## Runtime",
    `You are running as ${runtime === "codex" ? "Codex" : "Claude Code"} on the user's machine, answering inside the AutoSEO chat UI.`,
    hasMcp
      ? "The AutoSEO tools are available through the `autoseo` MCP server (already authenticated and restricted to this project — omit projectId). Prefer them for all project data."
      : "The AutoSEO MCP server is not connected for this run — rely on the project details above and say which data you could not fetch.",
    "You may use the machine's other MCP servers and web search when they help answer the question. Do not modify local files or run shell commands unless the user explicitly asks. Attachments sent with the message are saved in the current working directory.",
    "Do not mention the connection or authorization status of unrelated tools, connectors or MCP servers.",
    "Your final message is shown to the user as the answer — write it as the complete reply (Markdown).",
  ].join("\n");
}
