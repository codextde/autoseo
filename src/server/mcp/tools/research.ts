import "server-only";
import { z } from "zod";
import {
  addResearchItemsToTracker,
  addToTrackerInput,
  brandLookupInput,
  generateResearchInput,
  generateResearchList,
  getLookupResult,
  listLookupHistory,
  listResearchItems,
  listResearchLists,
  promptExplorerInput,
  startBrandLookup,
  startPromptExplorer,
} from "@/server/api/research";
import type { BrandLookupResult, ExplorerResult } from "@/features/ai-research/types";
import { defineTool } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

const RO = { readOnlyHint: true, openWorldHint: false } as const;

/** Tool args minus the project selector (service inputs don't take it). */
function withoutProject<T extends { projectId?: string }>(args: T): Omit<T, "projectId"> {
  const rest: Partial<T> = { ...args };
  delete rest.projectId;
  return rest as Omit<T, "projectId">;
}
const PAID = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/** AI research: brand lookup, prompt explorer and prompt research lists (ai-research module). */
export const researchTools = [
  defineTool({
    name: "run_brand_lookup",
    title: "Brand lookup (AI mentions)",
    description:
      "Starts a Brand Lookup: how often ChatGPT and Google AI Overviews mention a brand or domain, top cited pages, top AI questions and share of voice vs up to 5 competitors. Uses DataForSEO credits (~$0.85 + ~$0.20 per competitor). Runs in the background — poll get_lookup_result with the returned lookupId (usually < 1 minute).",
    input: z.object({ projectId: projectIdInput, ...brandLookupInput.shape }),
    scope: "read",
    permission: "seo.run",
    annotations: PAID,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await startBrandLookup(ctx.principal, p, withoutProject(args));
      return {
        text: `Brand lookup ${r.lookupId} started for "${r.params.query}" (${r.params.country}). Poll get_lookup_result with lookupId "${r.lookupId}".`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/ai/brand-lookup` },
      };
    },
  }),

  defineTool({
    name: "run_prompt_explorer",
    title: "Prompt explorer (ask AI models)",
    description:
      "Asks one prompt to several AI models live (ChatGPT, Claude, Gemini, Perplexity via DataForSEO, and/or the local agent / AI API as `autoseo`) and records answers, citations, fan-out queries and whether the brand is mentioned. Uses DataForSEO / AI credits. Runs in the background — poll get_lookup_result with the returned lookupId.",
    input: z.object({ projectId: projectIdInput, ...promptExplorerInput.shape }),
    scope: "read",
    permission: "seo.run",
    annotations: PAID,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await startPromptExplorer(ctx.principal, p, withoutProject(args));
      return {
        text: `Prompt explorer ${r.lookupId} started on ${r.params.models.join(", ")} (${r.params.country}). Poll get_lookup_result with lookupId "${r.lookupId}".`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/ai/prompt-explorer` },
      };
    },
  }),

  defineTool({
    name: "get_lookup_result",
    title: "Brand lookup / explorer result",
    description: "Status and result of a brand lookup or prompt explorer run (status queued | running | done | failed). Call again later while it is queued or running.",
    input: z.object({
      projectId: projectIdInput,
      lookupId: z.string().max(64).describe("Id returned by run_brand_lookup / run_prompt_explorer or list_lookups."),
      maxAnswerChars: z.number().int().min(500).max(50_000).optional().describe("Truncate explorer answers (default 8000 chars each)."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await getLookupResult(p, args.lookupId, { maxAnswerChars: args.maxAnswerChars });
      let text = `${r.kind === "brand_lookup" ? "Brand lookup" : "Prompt explorer"} "${r.query}" — ${r.status}${r.error ? `: ${r.error}` : ""}.`;
      if (r.status === "queued" || r.status === "running") text += " Still running — call get_lookup_result again in ~20 seconds.";
      if (r.result && r.kind === "brand_lookup") {
        const b = r.result as BrandLookupResult;
        text += `\n\nMentions: ${b.totalMentions ?? "—"} · AI search volume: ${b.totalAiSearchVolume ?? "—"}\n\n${mdTable(b.perPlatform, [
          ["platform", (x) => x.platform],
          ["status", (x) => x.status],
          ["mentions", (x) => x.mentions],
          ["AI volume", (x) => x.aiSearchVolume],
        ])}\n\nTop AI questions:\n${mdTable(b.topQueries.slice(0, 15), [
          ["question", (x) => x.question],
          ["platform", (x) => x.platform],
          ["AI volume", (x) => x.aiSearchVolume],
          ["brands", (x) => x.brandsMentioned.slice(0, 5)],
        ])}`;
        if (b.shareOfVoice) {
          text += `\n\nShare of voice:\n${mdTable(b.shareOfVoice.entries, [
            ["brand", (x) => (x.isTarget ? `${x.label} (target)` : x.label)],
            ["mentions", (x) => x.mentions],
            ["share %", (x) => x.sharePct],
          ])}`;
        }
      } else if (r.result && r.kind === "prompt_explorer") {
        const e = r.result as ExplorerResult;
        text += `\n\n${mdTable(e.answers, [
          ["model", (x) => x.model],
          ["status", (x) => x.status],
          ["brand mentioned", (x) => x.brandMentioned],
          ["citations", (x) => x.citations.length],
          ["fan-outs", (x) => x.fanOutQueries.length],
        ])}\n\n${e.answers
          .filter((a) => a.status === "ok")
          .map((a) => `### ${a.model}${a.modelName ? ` (${a.modelName})` : ""}\n${a.text.slice(0, 3000)}`)
          .join("\n\n")}`;
      }
      return { text, data: { projectId: p.id, ...r } };
    },
  }),

  defineTool({
    name: "list_lookups",
    title: "Lookup history",
    description: "Recent brand lookups or prompt explorer runs of the project (id, query, status, cost).",
    input: z.object({
      projectId: projectIdInput,
      kind: z.enum(["brand_lookup", "prompt_explorer"]).describe("Which history to list."),
      limit: z.number().int().min(1).max(100).optional().describe("Default 30."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const items = await listLookupHistory(p, args.kind, args.limit ?? 30);
      return {
        text: `${items.length} ${args.kind === "brand_lookup" ? "brand lookup(s)" : "prompt explorer run(s)"}:\n\n${mdTable(items, [
          ["id", (x) => x.id],
          ["query", (x) => x.query],
          ["status", (x) => x.status],
          ["cost $", (x) => x.costUsd],
          ["created", (x) => x.createdAt.slice(0, 16)],
        ])}`,
        data: { projectId: p.id, kind: args.kind, items },
      };
    },
  }),

  defineTool({
    name: "list_prompt_research_lists",
    title: "Prompt research lists",
    description: "Prompt research lists of the project (researched questions people ask AI, not yet necessarily tracked) with item counts and generation status.",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const lists = await listResearchLists(p);
      return {
        text: `${lists.length} list(s):\n\n${mdTable(lists, [
          ["id", (l) => l.id],
          ["name", (l) => (l.isDefault ? `${l.name} (default)` : l.name)],
          ["prompts", (l) => l.itemCount],
          ["status", (l) => l.status],
          ["source", (l) => l.source],
        ])}`,
        data: { projectId: p.id, lists, url: `${ctx.baseUrl}/p/${p.id}/ai/prompt-research` },
      };
    },
  }),

  defineTool({
    name: "list_prompt_research_items",
    title: "Prompt research items",
    description:
      "Researched prompts of a list (default list if omitted) with topic, funnel stage (tofu/mofu/bofu), persona, intent, branded flag, estimated volume and whether already tracked. Use add_research_prompts_to_tracker to start tracking selected ones.",
    input: z.object({
      projectId: projectIdInput,
      listId: z.string().max(64).optional(),
      topic: z.string().max(120).optional(),
      funnelStage: z.enum(["tofu", "mofu", "bofu"]).optional(),
      search: z.string().max(200).optional(),
      untrackedOnly: z.boolean().optional(),
      page: z.number().int().min(1).max(1000).optional(),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listResearchItems(p, {
        listId: args.listId,
        topic: args.topic,
        funnelStage: args.funnelStage,
        search: args.search,
        untrackedOnly: args.untrackedOnly ? "true" : undefined,
        page: args.page ?? 1,
        limit: args.limit ?? 100,
      });
      return {
        text: r.list
          ? `List "${r.list.name}" (${r.list.id}) — ${r.pagination.total} prompt(s), page ${r.pagination.page}/${r.pagination.totalPages}\n\n${mdTable(r.items, [
              ["id", (i) => i.id],
              ["prompt", (i) => i.text],
              ["topic", (i) => i.topic],
              ["funnel", (i) => i.funnelStage],
              ["volume", (i) => i.volume ?? (i.volumeScore != null ? `score ${Math.round(i.volumeScore * 100)}` : null)],
              ["tracked", (i) => Boolean(i.trackedPromptId)],
            ])}`
          : "This project has no prompt research list yet — use generate_prompt_research.",
        data: { projectId: p.id, ...r },
      };
    },
  }),

  defineTool({
    name: "generate_prompt_research",
    title: "Generate prompt research",
    description:
      "Generates a set of realistic prompts people ask AI about the project's market (topics, personas, funnel stages, branded share, competitor comparisons) into a new or existing list, with volume estimates. Uses the local agent / AI API (and DataForSEO volumes when configured). Runs in the background (a few minutes) — check list_prompt_research_lists for status.",
    input: z.object({ projectId: projectIdInput, ...generateResearchInput.shape }),
    scope: "write",
    permission: "prompts.manage",
    annotations: PAID,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await generateResearchList(ctx.principal, p, withoutProject(args));
      return {
        text: `Generating ${r.count} prompts into list "${r.listName}" (${r.listId}), job ${r.jobId ?? "—"}. Check list_prompt_research_lists / list_prompt_research_items in a few minutes.`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/ai/prompt-research` },
      };
    },
  }),

  defineTool({
    name: "add_research_prompts_to_tracker",
    title: "Track researched prompts",
    description:
      "Adds prompt research items (by item id) to daily AI visibility tracking; identical tracked prompts are linked instead of duplicated. The first tracking run starts right away; the project's prompt limit applies.",
    input: z.object({ projectId: projectIdInput, ...addToTrackerInput.shape }),
    scope: "write",
    permission: "prompts.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await addResearchItemsToTracker(ctx.principal, p, { itemIds: args.itemIds });
      return {
        text:
          r.added + r.linked + r.skippedOverLimit === 0
            ? "No untracked research items matched these ids (already tracked or unknown)."
            : `Tracking ${r.added} new prompt(s), linked ${r.linked} already-tracked${r.skippedOverLimit ? `, ${r.skippedOverLimit} skipped (prompt limit)` : ""}.`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/ai/tracker` },
      };
    },
  }),
];

