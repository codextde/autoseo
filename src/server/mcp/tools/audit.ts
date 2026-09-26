import "server-only";
import { z } from "zod";
import { deleteAudit, startAudit, stopAudit } from "@/server/audit-crawler/service";
import { startCrawlabilityCheck } from "@/server/crawlability/service";
import { logAudit } from "@/server/audit";
import { apiActor } from "@/server/api/module-context";
import {
  auditCompare,
  auditIssues,
  auditIssuesQuery,
  auditLighthouse,
  auditLighthouseResult,
  auditOverview,
  auditPages,
  auditStatus,
  crawlabilityCheck,
  crawlabilityHistory,
  listAudits,
  resolveAuditId,
  startAuditBody,
  waitForCrawlability,
} from "@/server/api/audit";
import { defineTool } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const auditIdInput = z.string().max(64).optional().describe("Audit id (from list_site_audits). Default: the latest audit.");
const auditUrl = (base: string, projectId: string, auditId?: string) => `${base}/p/${projectId}/seo/audit${auditId ? `/${auditId}` : ""}`;

/** open-seo site audit tools (+ compare / overview / Lighthouse) and the AI crawlability check. */
export const auditTools = [
  defineTool({
    name: "run_site_audit",
    title: "Run site audit",
    description:
      "Starts a background technical SEO crawl of the project's site (status codes, titles/meta, headings, canonicals, redirects, broken links, indexability, duplicates, performance hints). The crawl itself is free; optional Lighthouse runs on ≤10 sample pages via Google PageSpeed Insights (free) or DataForSEO (paid, ≈$0.004/page). Only one audit per project can run at a time. Returns auditId — poll get_audit_status until done, then read get_audit_issues / get_audit_pages.",
    input: z.object({
      projectId: projectIdInput,
      url: z.string().trim().max(2048).optional().describe("Start URL (default: the project's website)."),
      maxPages: z.number().int().min(10).max(100_000).optional().describe("Pages to crawl (default 50; capped by the instance limit)."),
      runLighthouse: z.boolean().optional().describe("Also run Lighthouse on up to 10 representative pages (default false)."),
      lighthouseProvider: startAuditBody.shape.lighthouseProvider.optional(),
    }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const res = await startAudit(apiActor(ctx.principal, p), {
        startUrl: args.url,
        maxPages: args.maxPages ?? 50,
        lighthouse: args.runLighthouse ?? false,
        lighthouseProvider: args.lighthouseProvider ?? "psi",
        trigger: "mcp",
      });
      void logAudit("site_audit.start", {
        actor: { id: ctx.principal.user.id, email: ctx.principal.user.email },
        targetType: "site_audit",
        targetId: res.auditId,
        projectId: p.id,
        workspaceId: p.workspaceId,
        meta: { startUrl: res.startUrl, maxPages: args.maxPages ?? 50, lighthouse: args.runLighthouse ?? false, via: "mcp" },
      });
      const url = auditUrl(ctx.baseUrl, p.id, res.auditId);
      return {
        text: `Site audit started for ${res.startUrl} (auditId ${res.auditId}). Poll get_audit_status until status is completed.\n${url}`,
        data: { projectId: p.id, auditId: res.auditId, startUrl: res.startUrl, url },
      };
    },
  }),

  defineTool({
    name: "get_audit_status",
    title: "Site audit status",
    description:
      "Progress of a site audit: status (queued/running/completed/failed/cancelled), phase, pages crawled vs planned, Lighthouse progress, score (0–100) and the most recently crawled pages. Defaults to the latest audit.",
    input: z.object({ projectId: projectIdInput, auditId: auditIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const id = await resolveAuditId(p.id, args.auditId);
      const s = await auditStatus(p.id, id, 10);
      const lh = s.lighthouseTotal ? `, Lighthouse ${s.lighthouseCompleted}/${s.lighthouseTotal}${s.lighthouseFailed ? ` (${s.lighthouseFailed} failed)` : ""}` : "";
      return {
        text: `Audit ${s.id} (${s.startUrl}) — ${s.status} · phase ${s.currentPhase} · ${s.pagesCrawled}/${s.pagesTotal} pages${lh}${s.score != null ? ` · score ${s.score}/100` : ""}${s.errorCode ? ` · error ${s.errorCode}: ${s.errorDetail ?? ""}` : ""}${s.done ? "" : "\nStill running — call get_audit_status again in ~30 seconds."}`,
        data: { projectId: p.id, status: s, url: auditUrl(ctx.baseUrl, p.id, s.id) },
      };
    },
  }),

  defineTool({
    name: "get_audit_overview",
    title: "Site audit overview",
    description:
      "Health summary of one audit: score, issue counts by category and severity, page statistics (2xx/3xx/4xx, blocked, indexable, avg response time, avg words) and Lighthouse averages. Defaults to the latest audit.",
    input: z.object({ projectId: projectIdInput, auditId: auditIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const id = await resolveAuditId(p.id, args.auditId);
      const o = await auditOverview(p.id, id);
      const pg = o.pages;
      return {
        text: `**Audit ${o.audit.id}** (${o.audit.startUrl}) — ${o.audit.status}, score ${o.audit.score ?? "—"}/100, ${pg.total} pages (${pg.ok} ok, ${pg.redirects} redirects, ${pg.broken} broken, ${pg.blocked} blocked, ${pg.indexable} indexable, avg ${pg.avgResponseMs ?? "—"} ms)\n\n${mdTable(o.categories, [
          ["category", (c) => c.label],
          ["issues", (c) => c.issues],
          ["critical", (c) => c.critical],
          ["warning", (c) => c.warning],
          ["info", (c) => c.info],
        ])}${o.lighthouse.tests ? `\n\nLighthouse (avg of ${o.lighthouse.tests}): performance ${o.lighthouse.avgPerformance ?? "—"}, accessibility ${o.lighthouse.avgAccessibility ?? "—"}, best practices ${o.lighthouse.avgBestPractices ?? "—"}, SEO ${o.lighthouse.avgSeo ?? "—"}` : ""}`,
        data: { projectId: p.id, ...o, url: auditUrl(ctx.baseUrl, p.id, id) },
      };
    },
  }),

  defineTool({
    name: "get_audit_issues",
    title: "Site audit issues",
    description:
      "Issues found by a site audit: a summary per issue type (title, severity, count, pages) plus affected URLs with details and how to fix. Filter by severity (critical/warning/info), issueType, category or URL substring. Defaults to the latest audit.",
    input: z.object({
      projectId: projectIdInput,
      auditId: auditIdInput,
      severity: auditIssuesQuery.shape.severity,
      issueType: auditIssuesQuery.shape.issueType,
      category: auditIssuesQuery.shape.category,
      search: auditIssuesQuery.shape.search,
      limit: z.number().int().min(1).max(1000).optional().describe("Affected URLs to return (default 200)."),
      page: z.number().int().min(1).max(10_000).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const id = await resolveAuditId(p.id, args.auditId);
      const r = await auditIssues(p.id, id, {
        severity: args.severity,
        issueType: args.issueType,
        category: args.category,
        search: args.search,
        limit: args.limit ?? 200,
        page: args.page ?? 1,
      });
      return {
        text: `${r.summary.length} issue type(s), ${r.pagination.total} matching affected URL(s) (audit ${id}).\n\n${mdTable(r.summary, [
          ["severity", (s) => s.severity],
          ["issueType", (s) => s.issueType],
          ["title", (s) => s.title],
          ["count", (s) => s.count],
          ["pages", (s) => s.pages],
        ])}\n\nAffected URLs:\n${mdTable(r.issues, [
          ["severity", (i) => i.severity],
          ["issue", (i) => i.title],
          ["url", (i) => i.url],
        ], 40)}`,
        data: { projectId: p.id, auditId: id, ...r, url: auditUrl(ctx.baseUrl, p.id, id) },
      };
    },
  }),

  defineTool({
    name: "get_audit_pages",
    title: "Site audit pages",
    description:
      "Crawled pages of a site audit with SEO data: status code, fetch outcome, title, meta description, H1 count, word count, images missing alt, response time, indexability, crawl depth, inlinks, issue count and page score. Filter by status class, indexability, pages with issues or URL/title search; sortable. Defaults to the latest audit.",
    input: z.object({
      projectId: projectIdInput,
      auditId: auditIdInput,
      status: z.enum(["2xx", "3xx", "4xx", "5xx", "error", "blocked"]).optional(),
      indexable: z.boolean().optional(),
      withIssues: z.boolean().optional(),
      missingAlt: z.boolean().optional(),
      search: z.string().max(500).optional(),
      sort: z.enum(["url", "status", "title", "h1", "words", "images", "speed", "depth", "inlinks", "issues", "score"]).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(1000).optional().describe("Default 100."),
      page: z.number().int().min(1).max(10_000).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const id = await resolveAuditId(p.id, args.auditId);
      const r = await auditPages(p.id, id, {
        status: args.status,
        indexable: args.indexable === undefined ? undefined : args.indexable ? "yes" : "no",
        withIssues: args.withIssues ? "true" : undefined,
        missingAlt: args.missingAlt ? "true" : undefined,
        search: args.search,
        sort: args.sort ?? "url",
        dir: args.dir ?? "asc",
        limit: args.limit ?? 100,
        page: args.page ?? 1,
      });
      return {
        text: `${r.pagination.total} page(s) (audit ${id}), page ${r.pagination.page}/${r.pagination.totalPages}.\n\n${mdTable(r.pages, [
          ["status", (x) => x.statusCode ?? x.fetchClass],
          ["url", (x) => x.url],
          ["title", (x) => x.title],
          ["words", (x) => x.wordCount],
          ["indexable", (x) => x.isIndexable],
          ["depth", (x) => x.crawlDepth],
          ["issues", (x) => x.issueCount],
        ])}`,
        data: { projectId: p.id, auditId: id, ...r, url: auditUrl(ctx.baseUrl, p.id, id) },
      };
    },
  }),

  defineTool({
    name: "list_site_audits",
    title: "List site audits",
    description: "Site audits of the project, newest first: id, start URL, status, pages crawled, score, issue counts and dates.",
    input: z.object({ projectId: projectIdInput, limit: z.number().int().min(1).max(50).optional().describe("Default 20.") }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const audits = await listAudits(p.id, args.limit ?? 20);
      return {
        text: `${audits.length} audit(s):\n\n${mdTable(audits, [
          ["id", (a) => a.id],
          ["status", (a) => a.status],
          ["startUrl", (a) => a.startUrl],
          ["pages", (a) => a.pagesCrawled],
          ["score", (a) => a.score],
          ["started", (a) => a.startedAt.slice(0, 16).replace("T", " ")],
        ])}`,
        data: { projectId: p.id, audits, url: auditUrl(ctx.baseUrl, p.id) },
      };
    },
  }),

  defineTool({
    name: "compare_site_audits",
    title: "Compare site audits",
    description:
      "Diff of two site audits: issue counts per type before/after, plus new and resolved issue URLs. Defaults to the latest completed audit vs the completed audit before it.",
    input: z.object({
      projectId: projectIdInput,
      baseAuditId: z.string().max(64).optional().describe("Older audit (default: the completed audit before the target)."),
      targetAuditId: z.string().max(64).optional().describe("Newer audit (default: the latest completed audit)."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const c = await auditCompare(p.id, { base: args.baseAuditId, target: args.targetAuditId });
      return {
        text: `Audit ${c.base.id} (${c.base.startedAt.slice(0, 10)}, score ${c.base.score ?? "—"}) → ${c.target.id} (${c.target.startedAt.slice(0, 10)}, score ${c.target.score ?? "—"}): ${c.newCount} new issue(s), ${c.resolvedCount} resolved.\n\n${mdTable(c.byIssueType, [
          ["severity", (r) => r.severity],
          ["issue", (r) => r.title],
          ["before", (r) => r.before],
          ["after", (r) => r.after],
          ["change", (r) => r.delta],
        ])}`,
        data: { projectId: p.id, ...c, url: `${ctx.baseUrl}/p/${p.id}/seo/audit/compare?base=${c.base.id}&target=${c.target.id}` },
      };
    },
  }),

  defineTool({
    name: "get_audit_lighthouse",
    title: "Site audit Lighthouse results",
    description:
      "Lighthouse results of a site audit (only audits started with runLighthouse): per URL and strategy the performance, accessibility, best-practices and SEO scores plus LCP/CLS/INP/TTFB. Pass resultId for the detailed, prioritized Lighthouse issues of one result (optionally one category).",
    input: z.object({
      projectId: projectIdInput,
      auditId: auditIdInput,
      resultId: z.string().max(64).optional(),
      category: z.enum(["performance", "accessibility", "best-practices", "seo", "all"]).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const id = await resolveAuditId(p.id, args.auditId);
      if (args.resultId) {
        const r = await auditLighthouseResult(p.id, id, args.resultId, args.category ?? "all");
        return {
          text: `Lighthouse ${r.result.strategy} for ${r.finalUrl}: performance ${r.result.performanceScore ?? "—"}, accessibility ${r.result.accessibilityScore ?? "—"}, best practices ${r.result.bestPracticesScore ?? "—"}, SEO ${r.result.seoScore ?? "—"} — ${r.issueCount} issue(s).\n\n${mdTable(r.issues, [
            ["issue", (i) => i.title],
            ["severity", (i) => i.severity],
            ["score", (i) => i.score],
            ["value", (i) => i.displayValue],
          ], 30)}`,
          data: { projectId: p.id, auditId: id, ...r, url: `${auditUrl(ctx.baseUrl, p.id, id)}/lighthouse/${args.resultId}` },
        };
      }
      const rows = await auditLighthouse(p.id, id);
      return {
        text: rows.length
          ? `${rows.length} Lighthouse result(s) (audit ${id}):\n\n${mdTable(rows, [
              ["id", (r) => r.id],
              ["url", (r) => r.url],
              ["strategy", (r) => r.strategy],
              ["status", (r) => r.status],
              ["perf", (r) => r.performanceScore],
              ["a11y", (r) => r.accessibilityScore],
              ["best", (r) => r.bestPracticesScore],
              ["seo", (r) => r.seoScore],
              ["LCP ms", (r) => r.lcpMs],
            ])}`
          : `Audit ${id} has no Lighthouse results — start an audit with runLighthouse: true.`,
        data: { projectId: p.id, auditId: id, results: rows, url: auditUrl(ctx.baseUrl, p.id, id) },
      };
    },
  }),

  defineTool({
    name: "stop_site_audit",
    title: "Stop site audit",
    description: "Stops a queued or running site audit; pages crawled so far are kept and finalized.",
    input: z.object({ projectId: projectIdInput, auditId: z.string().max(64).describe("The running audit.") }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await stopAudit(p.id, args.auditId);
      return {
        text: r.finalizing ? `Stopping audit ${args.auditId} — finalizing the results crawled so far.` : `Audit ${args.auditId} cancelled.`,
        data: { projectId: p.id, auditId: args.auditId, ...r },
      };
    },
  }),

  defineTool({
    name: "delete_site_audit",
    title: "Delete site audit",
    description: "Permanently deletes a site audit with all crawled pages, issues and Lighthouse results (stops it first if running). auditId is required — never defaults.",
    input: z.object({ projectId: projectIdInput, auditId: z.string().max(64).describe("Audit to delete.") }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      await deleteAudit(p.id, args.auditId);
      void logAudit("site_audit.delete", {
        actor: { id: ctx.principal.user.id, email: ctx.principal.user.email },
        targetType: "site_audit",
        targetId: args.auditId,
        projectId: p.id,
        workspaceId: p.workspaceId,
        meta: { via: "mcp" },
      });
      return { text: `Deleted audit ${args.auditId}.`, data: { projectId: p.id, auditId: args.auditId, deleted: true } };
    },
  }),

  defineTool({
    name: "run_crawlability_check",
    title: "Run AI crawlability check",
    description:
      "Checks whether AI crawlers and answer engines (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, …) can access the site: robots.txt rules per bot, live HTTP fetches, meta/X-Robots directives, llms.txt, sitemaps, canonicals and rendering. Free. Runs in the background; waits up to waitSeconds for the result, otherwise returns the checkId for get_crawlability_check.",
    input: z.object({
      projectId: projectIdInput,
      urls: z.array(z.string().trim().max(2048)).max(10).optional().describe("Up to 10 extra pages of the project's site to test (home page is always tested)."),
      waitSeconds: z.number().int().min(0).max(55).optional().describe("How long to wait for completion (default 45)."),
    }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const { checkId } = await startCrawlabilityCheck(apiActor(ctx.principal, p), { urls: args.urls ?? [], trigger: "mcp" });
      void logAudit("crawlability.start", {
        actor: { id: ctx.principal.user.id, email: ctx.principal.user.email },
        targetType: "crawlability_check",
        targetId: checkId,
        projectId: p.id,
        workspaceId: p.workspaceId,
        meta: { via: "mcp" },
      });
      const c = await waitForCrawlability(p.id, checkId, args.waitSeconds ?? 45);
      return crawlabilityResult(c, ctx.baseUrl, p.id);
    },
  }),

  defineTool({
    name: "get_crawlability_check",
    title: "AI crawlability results",
    description:
      "Result of an AI crawlability check: overall and per-category scores, findings with fixes (critical first), per-bot access (robots.txt + HTTP), llms.txt / llms-full.txt presence, sitemap and tested pages. Defaults to the latest check; also lists recent checks.",
    input: z.object({ projectId: projectIdInput, checkId: z.string().max(64).optional() }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const [c, recent] = await Promise.all([crawlabilityCheck(p.id, args.checkId), crawlabilityHistory(p.id, 10)]);
      const out = crawlabilityResult(c, ctx.baseUrl, p.id);
      return { ...out, data: { ...out.data, recentChecks: recent } };
    },
  }),
];

type CrawlSummary = Awaited<ReturnType<typeof crawlabilityCheck>>;

function crawlabilityResult(c: CrawlSummary, baseUrl: string, projectId: string) {
  const url = `${baseUrl}/p/${projectId}/crawlability/${c.id}`;
  const data = { projectId, check: c, url };
  if (c.status !== "completed" || !c.result) {
    return {
      text:
        c.status === "failed"
          ? `Crawlability check ${c.id} failed: ${c.error ?? "unknown error"}.`
          : `Crawlability check ${c.id} is ${c.status}${c.progress ? ` (${JSON.stringify(c.progress)})` : ""} — call get_crawlability_check with checkId ${c.id} in ~30 seconds.`,
      data,
      isError: c.status === "failed",
    };
  }
  const r = c.result;
  const issues = r.findings.filter((f) => f.severity !== "pass");
  return {
    text: `AI crawlability of ${c.origin}: score ${c.score ?? "—"}/100 · llms.txt ${r.llms.txt.present ? "present" : "missing"} · robots.txt ${r.robots.found ? "found" : "missing"} · sitemap ${r.sitemap.found ? `${r.sitemap.totalUrls} URLs` : "missing"}\n\n${mdTable(r.bots, [
      ["bot", (b) => b.name],
      ["company", (b) => b.company],
      ["purpose", (b) => b.purpose],
      ["access", (b) => b.overall],
      ["robots.txt", (b) => b.robots],
      ["http", (b) => b.http],
    ])}\n\nFindings:\n${mdTable(issues, [
      ["severity", (f) => f.severity],
      ["category", (f) => f.category],
      ["finding", (f) => f.title],
      ["fix", (f) => f.fix],
    ], 30)}`,
    data,
  };
}
