import "server-only";
import { z } from "zod";
import { TASK_CATEGORIES } from "@/server/db/schema";
import { getTaskForApi, listTasksForApi } from "@/server/api/tasks";
import { defineTool } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

/** finseo MCP tools — optimization tasks (read-only). */
export const taskTools = [
  defineTool({
    name: "list_tasks",
    title: "List optimization tasks",
    description:
      "Prioritized, evidence-backed optimization tasks generated from AI visibility, citations, competitors, crawl access and Search Console data. Filter by status, category and minimum impact.",
    input: z.object({
      projectId: projectIdInput,
      status: z.enum(["open", "in_progress", "done", "dismissed", "active", "all"]).optional().describe("Default active (open + in_progress)."),
      category: z.enum(TASK_CATEGORIES).optional(),
      minImpact: z.number().int().min(1).max(10).optional(),
      search: z.string().max(200).optional(),
      page: z.number().int().min(1).max(1000).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listTasksForApi(p.id, {
        status: args.status ?? "active",
        category: args.category,
        minImpact: args.minImpact,
        search: args.search,
        page: args.page ?? 1,
        limit: args.limit ?? 50,
      });
      return {
        text: `${r.pagination.total} task(s) — open ${r.counts.open}, in progress ${r.counts.inProgress}, high impact ${r.counts.highImpact}, done (30d) ${r.counts.done30}\n\n${mdTable(r.items, [
          ["id", (t) => t.id],
          ["title", (t) => t.title],
          ["category", (t) => t.category],
          ["status", (t) => t.status],
          ["impact", (t) => t.impact],
          ["effort", (t) => t.effort],
          ["steps", (t) => `${t.stepsDone}/${t.stepsTotal}`],
        ])}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/tasks` },
      };
    },
  }),
  defineTool({
    name: "get_task_details",
    title: "Task details",
    description: "One optimization task with description, steps, acceptance criteria, content plan, target URLs/prompts, evidence and activity.",
    input: z.object({ projectId: projectIdInput, taskId: z.string().max(64) }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const t = await getTaskForApi(p.id, args.taskId);
      const steps = t.steps.map((s, i) => `${i + 1}. [${s.done ? "x" : " "}] ${s.text}`).join("\n");
      return {
        text: `**${t.title}** — ${t.category}, ${t.status}, impact ${t.impact}/10, effort ${t.effort}/10\n\n${t.summary}\n\n${t.description}${steps ? `\n\n**Steps**\n${steps}` : ""}`,
        data: { projectId: p.id, task: t, url: `${ctx.baseUrl}/p/${p.id}/tasks?task=${t.id}` },
      };
    },
  }),
];
