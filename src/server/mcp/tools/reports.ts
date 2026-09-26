import "server-only";
import { z } from "zod";
import {
  deleteReportForApi,
  deleteTemplateForApi,
  generateReportForApi,
  generateReportInput,
  getReportForApi,
  listReportsForApi,
  listTemplatesForApi,
  saveReportForApi,
  saveReportInput,
  saveTemplateForApi,
  saveTemplateInput,
  shareReportForApi,
  shareReportInput,
} from "@/server/api/reports";
import { defineTool } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

const RO = { readOnlyHint: true, openWorldHint: false } as const;

/** Tool args minus the project selector (service inputs don't take it). */
function withoutProject<T extends { projectId?: string }>(args: T): Omit<T, "projectId"> {
  const rest: Partial<T> = { ...args };
  delete rest.projectId;
  return rest as Omit<T, "projectId">;
}

/** Report Builder: agent-written HTML reports, templates and share links (open-seo report tools). */
export const reportsTools = [
  defineTool({
    name: "save_report",
    title: "Save report",
    description:
      "Saves a finished, self-contained HTML report to the project's Report Builder (pass reportId to replace one in place). Title = report type + full date (e.g. \"Competitive Landscape — Sep 17, 2026\"); summary = markdown verdict → top action → key numbers (≤2,500 chars); html = complete document starting with <html and ending with </html> (≤500 KB, inline CSS/SVG only, no external scripts). Reply to the user with the returned url, a one-line verdict and the top action.",
    input: z.object({ projectId: projectIdInput, ...saveReportInput.shape }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await saveReportForApi(ctx.principal, p, ctx.baseUrl, withoutProject(args));
      return {
        text: `${r.created ? "Saved" : "Updated"} report "${r.title}" (${r.reportId}, ${Math.ceil(r.htmlBytes / 1000)} KB): ${r.url}\nReply with this link, a one-line verdict and the top action.`,
        data: { projectId: p.id, ...r },
      };
    },
  }),

  defineTool({
    name: "generate_report",
    title: "Generate AI report",
    description:
      "Has the app's AI write an HTML report from the project's live data (visibility, competitors, sources, SEO…) following a prompt and optional template. Uses the local agent / AI API. Runs in the background — poll get_report until aiStatus is ready.",
    input: z.object({ projectId: projectIdInput, ...generateReportInput.shape }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await generateReportForApi(ctx.principal, p, ctx.baseUrl, withoutProject(args));
      return { text: `Generating report ${r.reportId} — poll get_report until aiStatus is "ready": ${r.url}`, data: { projectId: p.id, ...r } };
    },
  }),

  defineTool({
    name: "list_reports",
    title: "List reports",
    description: "Reports of the project (AI/agent HTML reports and slide decks), newest first, with status, author and share state. Use get_report for the summary and HTML.",
    input: z.object({
      projectId: projectIdInput,
      kind: z.enum(["deck", "html", "all"]).optional().describe("Default all."),
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
      offset: z.number().int().min(0).max(10_000).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listReportsForApi(p, ctx.baseUrl, { kind: args.kind ?? "all", limit: args.limit ?? 20, offset: args.offset ?? 0 });
      return {
        text: `${r.total} report(s)${r.remaining ? `, ${r.remaining} more` : ""}:\n\n${mdTable(r.items, [
          ["id", (x) => x.id],
          ["title", (x) => x.title],
          ["kind", (x) => x.kind],
          ["status", (x) => (x.kind === "html" && x.aiStatus !== "ready" && x.aiStatus !== "idle" ? `${x.status} · ${x.aiStatus}` : x.status)],
          ["shared", (x) => x.shareEnabled],
          ["by", (x) => x.createdBy],
          ["updated", (x) => x.updatedAt.slice(0, 10)],
        ])}`,
        data: { projectId: p.id, ...r },
      };
    },
  }),

  defineTool({
    name: "get_report",
    title: "Get report",
    description: "One report's metadata, summary, AI status and share link; pass includeHtml=true to also get the HTML of an HTML report (large).",
    input: z.object({ projectId: projectIdInput, reportId: z.string().max(64), includeHtml: z.boolean().optional() }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await getReportForApi(p, ctx.baseUrl, args.reportId, Boolean(args.includeHtml));
      const html = "html" in r && typeof r.html === "string" ? r.html : null;
      return {
        text: `**${r.title}** (${r.kind}, ${r.status}${r.kind === "html" ? `, AI ${r.aiStatus}` : ""}) — ${r.url}${r.shareUrl ? `\nShare link: ${r.shareUrl}` : ""}${r.aiError ? `\nError: ${r.aiError}` : ""}${r.summary ? `\n\n${r.summary}` : ""}${html ? `\n\n${html}` : ""}`,
        data: { projectId: p.id, report: r },
      };
    },
  }),

  defineTool({
    name: "delete_report",
    title: "Delete report",
    description: "Permanently deletes a report; its public share link stops working.",
    input: z.object({ projectId: projectIdInput, reportId: z.string().max(64) }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await deleteReportForApi(ctx.principal, p, args.reportId);
      return { text: `Deleted report ${r.reportId}.`, data: { projectId: p.id, ...r } };
    },
  }),

  defineTool({
    name: "share_report",
    title: "Share report",
    description:
      "Creates or updates a public, read-only share link for a report (optional password and expiry), disables it, or revokes it permanently (revoke=true rotates the token so the old URL dies). Returns the share URL.",
    input: z.object({ projectId: projectIdInput, reportId: z.string().max(64), ...shareReportInput.shape }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const { reportId, ...input } = withoutProject(args);
      const r = await shareReportForApi(ctx.principal, p, ctx.baseUrl, reportId, input);
      return {
        text: r.shareUrl ? `Share link: ${r.shareUrl}${r.hasPassword ? " (password protected)" : ""}${r.expiresAt ? `, expires ${r.expiresAt.slice(0, 10)}` : ""}` : "Sharing is disabled for this report.",
        data: { projectId: p.id, ...r },
      };
    },
  }),

  defineTool({
    name: "list_report_templates",
    title: "List report templates",
    description: "Workspace report templates (instruction templates for agent/AI reports, and slide-deck templates) with their full instructions.",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const templates = await listTemplatesForApi(p);
      return {
        text: `${templates.length} template(s):\n\n${templates
          .map((t) => `### ${t.name} (${t.id}, ${t.kind})${t.description ? `\n_${t.description}_` : ""}${t.instructions ? `\n${t.instructions}` : ""}`)
          .join("\n\n") || "_No templates yet._"}`,
        data: { projectId: p.id, templates, remaining: Math.max(0, 200 - templates.length) },
      };
    },
  }),

  defineTool({
    name: "save_report_template",
    title: "Save report template",
    description:
      "Creates or updates (templateId) a workspace report template: name (unique), description (when to use it) and markdown instructions (audience, sections in order, tone, sign-off, optional `accent: #hex`).",
    input: z.object({ projectId: projectIdInput, ...saveTemplateInput.shape }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await saveTemplateForApi(ctx.principal, p, withoutProject(args));
      return { text: `${r.created ? "Created" : "Updated"} template "${r.name}" (${r.templateId}).`, data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/reports` } };
    },
  }),

  defineTool({
    name: "delete_report_template",
    title: "Delete report template",
    description: "Deletes a workspace report template. Reports created from it are kept.",
    input: z.object({ projectId: projectIdInput, templateId: z.string().max(64) }),
    scope: "write",
    permission: "reports.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await deleteTemplateForApi(p, args.templateId);
      return { text: `Deleted template ${r.templateId}.`, data: { projectId: p.id, ...r } };
    },
  }),
];
