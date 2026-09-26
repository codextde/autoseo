import "server-only";
import { z } from "zod";
import {
  applyContextPatch,
  contextPatchOp,
  getStructuredProjectContext,
  renderStructuredContext,
} from "@/server/api/project-context";
import type { StructuredContext } from "@/server/api/project-context";
import { defineTool } from "../types";
import { projectIdInput, toolProject } from "../helpers";

/** Structured data without the raw note rows (already represented in sections/lists). */
function withoutNotes(c: StructuredContext) {
  return Object.fromEntries(Object.entries(c).filter(([k]) => k !== "notes"));
}

/**
 * Shared project context ("memory") read/written by humans and agents (open-seo §13). Backed by the
 * ai-research module's context notes; users edit the same data on the project's Brand Knowledge page.
 */
export const contextTools = [
  defineTool({
    name: "get_project_context",
    title: "Get project context",
    description:
      "Reads the project's shared memory: prose sections (business_overview, goal, positioning, audience, writing), missingSections, SEO competitors, key pages, the newest 20 research-log entries and the workspace's report templates. Free. Call this first before any research for a project, and reuse research-log results under 30 days old instead of re-buying data.",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const c = await getStructuredProjectContext(p.id, p.workspaceId);
      return { text: renderStructuredContext(c), data: { projectId: p.id, ...withoutNotes(c), url: `${ctx.baseUrl}/p/${p.id}/knowledge` } };
    },
  }),

  defineTool({
    name: "update_project_context",
    title: "Update project context",
    description:
      "Writes durable facts back to the project context (free). Ops, applied in order: set_section {section, content} (empty clears); add_competitors {competitors:[{domain,name?,notes?}]} / remove_competitors {domains}; add_key_pages {pages:[{url,role?(hub|spoke|money|other),topic?,notes?}]} / remove_key_pages {urls}; append_research_log {summary} (one line: \"<Skill>: <inputs>. Verdict: <conclusion>\") / remove_research_log {ids}; upsert_note / delete_note for free-form notes. Only write what the user confirmed or you verified; never overwrite rows the user added unless asked.",
    input: z.object({
      projectId: projectIdInput,
      updates: z.array(contextPatchOp).min(1).max(50),
    }),
    scope: "write",
    permission: "prompts.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const changed = await applyContextPatch(p.id, args.updates, { kind: "mcp", userId: ctx.principal.user.id });
      const c = await getStructuredProjectContext(p.id, p.workspaceId);
      return {
        text: `Updated project context (${changed} change(s)).\n\n${renderStructuredContext(c)}`,
        data: { projectId: p.id, changed, ...withoutNotes(c) },
      };
    },
  }),
];
