import "server-only";
import { z } from "zod";
import { appendResearchLog, deleteContextNote, listContextNotes, upsertContextNote } from "@/server/ai/knowledge/context";
import { listTemplates } from "@/server/reports/service";
import { normalizeDomain } from "@/server/projects";
import { CONTEXT_CATEGORY_LABELS, type ContextNote } from "@/features/ai-research/types";
import { ApiError } from "./errors";

/**
 * Structured view of the project context ("memory") for agents, on top of the note store of the
 * ai-research module (`project_context_notes`). Prose sections, the SEO competitor list and the key
 * pages each live in one canonical note (fixed category + title) that users can also edit in the
 * app; the research log is one note per entry. Mirrors open-seo's project context model.
 */

export const SECTION_KEYS = ["business_overview", "goal", "positioning", "audience", "writing"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
/** Sections every workflow skill checks (open-seo: business_overview, current_goal, positioning, writing_preferences). */
export const CORE_SECTIONS: SectionKey[] = ["business_overview", "goal", "positioning", "writing"];

const COMPETITORS_TITLE = "SEO competitors";
const KEY_PAGES_TITLE = "Key pages";
const PROSE_MAX = 4000;
const LIST_MAX = 100;

export type ContextCompetitor = { domain: string; name: string | null; notes: string | null };
export type ContextKeyPage = { url: string; role: "hub" | "spoke" | "money" | "other" | null; topic: string | null; notes: string | null };

/* ───────────────────────────── Canonical list notes ───────────────────────────── */

// Lines look like "- example.com — Example Inc (wins every comparison query)".
function parseCompetitors(body: string): ContextCompetitor[] {
  const out: ContextCompetitor[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*[-*]\s+(\S+)(?:\s+—\s+([^()]+?))?\s*(?:\((.*)\))?\s*$/.exec(line);
    if (!m) continue;
    const domain = normalizeDomain(m[1]!);
    if (domain) out.push({ domain, name: m[2]?.trim() || null, notes: m[3]?.trim() || null });
  }
  return out;
}

function renderCompetitors(list: ContextCompetitor[]): string {
  return list.map((c) => `- ${c.domain}${c.name ? ` — ${c.name}` : ""}${c.notes ? ` (${c.notes.replace(/[()]/g, "")})` : ""}`).join("\n");
}

// Lines look like "- https://example.com/pricing — money · pricing (main conversion page)".
function parseKeyPages(body: string): ContextKeyPage[] {
  const out: ContextKeyPage[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*[-*]\s+(\S+)(?:\s+—\s+(hub|spoke|money|other)?(?:\s*·\s*)?([^()]*?))?\s*(?:\((.*)\))?\s*$/.exec(line);
    if (!m) continue;
    out.push({ url: m[1]!, role: (m[2] as ContextKeyPage["role"]) ?? null, topic: m[3]?.trim() || null, notes: m[4]?.trim() || null });
  }
  return out;
}

function renderKeyPages(list: ContextKeyPage[]): string {
  return list
    .map((p) => {
      const meta = [p.role, p.topic].filter(Boolean).join(" · ");
      return `- ${p.url}${meta ? ` — ${meta}` : ""}${p.notes ? ` (${p.notes.replace(/[()]/g, "")})` : ""}`;
    })
    .join("\n");
}

function canonicalNote(notes: ContextNote[], category: ContextNote["category"], title: string) {
  return notes.find((n) => n.category === category && n.title.trim().toLowerCase() === title.toLowerCase());
}

/* ───────────────────────────── Read model ───────────────────────────── */

export async function getStructuredProjectContext(projectId: string, workspaceId: string) {
  const [notes, templates] = await Promise.all([listContextNotes(projectId), listTemplates(workspaceId).catch(() => [])]);
  const sections = SECTION_KEYS.map((key) => {
    const list = notes.filter((n) => n.category === key);
    return {
      key,
      label: CONTEXT_CATEGORY_LABELS[key],
      content: list.map((n) => (list.length > 1 ? `### ${n.title}\n${n.body}` : n.body)).join("\n\n").trim(),
      updatedAt: list[0]?.updatedAt ?? null,
      updatedBy: list[0]?.updatedBy ?? null,
    };
  });
  const competitorNote = canonicalNote(notes, "competitors", COMPETITORS_TITLE);
  const keyPageNote = canonicalNote(notes, "key_pages", KEY_PAGES_TITLE);
  const researchLog = notes
    .filter((n) => n.category === "research_log")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((n) => ({ id: n.id, date: n.createdAt.slice(0, 10), summary: n.body || n.title, by: n.updatedBy }));
  return {
    sections,
    missingSections: CORE_SECTIONS.filter((k) => !sections.find((s) => s.key === k)?.content),
    competitors: competitorNote ? parseCompetitors(competitorNote.body) : [],
    keyPages: keyPageNote ? parseKeyPages(keyPageNote.body) : [],
    otherNotes: notes
      .filter((n) => ["competitors", "key_pages", "other"].includes(n.category) && n.id !== competitorNote?.id && n.id !== keyPageNote?.id)
      .map((n) => ({ id: n.id, category: n.category, title: n.title, body: n.body })),
    researchLog,
    reportTemplates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description ?? null })),
    notes,
  };
}

export type StructuredContext = Awaited<ReturnType<typeof getStructuredProjectContext>>;

export function renderStructuredContext(c: StructuredContext): string {
  const out = ["# Project context"];
  for (const s of c.sections) out.push(`\n## ${s.label}\n${s.content || "_(empty)_"}`);
  if (c.competitors.length) out.push(`\n## Competitors\n${renderCompetitors(c.competitors)}`);
  if (c.keyPages.length) out.push(`\n## Key pages\n${renderKeyPages(c.keyPages)}`);
  for (const n of c.otherNotes) out.push(`\n## ${n.title}\n${n.body}`);
  if (c.researchLog.length) {
    out.push(`\n## Research log (${c.researchLog.length} newest)\n${c.researchLog.map((r) => `- ${r.date}: ${r.summary.split("\n")[0]}`).join("\n")}`);
  }
  if (c.reportTemplates.length) out.push(`\n## Report templates\n${c.reportTemplates.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`);
  out.push(`\nMissing sections: ${c.missingSections.length ? c.missingSections.map((k) => CONTEXT_CATEGORY_LABELS[k]).join(", ") : "none"}`);
  return out.join("\n");
}

/* ───────────────────────────── Patch operations ───────────────────────────── */

const domainItem = z.object({
  domain: z.string().trim().min(3).max(255),
  name: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
const pageItem = z.object({
  url: z.string().trim().min(3).max(2048),
  role: z.enum(["hub", "spoke", "money", "other"]).optional(),
  topic: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const contextPatchOp = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("set_section"), section: z.enum(SECTION_KEYS), content: z.string().max(PROSE_MAX) })
    .describe("Replace a prose section (empty content clears it). Sections: business_overview, goal, positioning, audience, writing."),
  z.object({ op: z.literal("add_competitors"), competitors: z.array(domainItem).min(1).max(LIST_MAX) }).describe("Upsert SEO competitors by domain."),
  z.object({ op: z.literal("remove_competitors"), domains: z.array(z.string().max(255)).min(1).max(LIST_MAX) }),
  z.object({ op: z.literal("add_key_pages"), pages: z.array(pageItem).min(1).max(LIST_MAX) }).describe("Upsert key pages by URL (omitted role keeps the stored role)."),
  z.object({ op: z.literal("remove_key_pages"), urls: z.array(z.string().max(2048)).min(1).max(LIST_MAX) }),
  z.object({ op: z.literal("append_research_log"), summary: z.string().trim().min(1).max(1000) }).describe('One line, e.g. "Keyword research: solar storage (DE). Verdict: …".'),
  z.object({ op: z.literal("remove_research_log"), ids: z.array(z.string().max(40)).min(1).max(50) }),
  z
    .object({
      op: z.literal("upsert_note"),
      id: z.string().max(40).optional(),
      category: z.enum(["business_overview", "goal", "positioning", "audience", "writing", "competitors", "key_pages", "other"]),
      title: z.string().trim().min(1).max(160),
      body: z.string().max(8000),
      pinned: z.boolean().optional(),
    })
    .describe("Create (omit id) or replace a free-form note."),
  z.object({ op: z.literal("delete_note"), id: z.string().max(40) }),
]);
export type ContextPatchOp = z.infer<typeof contextPatchOp>;

async function saveListNote(projectId: string, existingId: string | undefined, category: "competitors" | "key_pages", title: string, body: string, author: Author) {
  if (!body.trim()) {
    if (existingId) await deleteContextNote(projectId, existingId);
    return;
  }
  await upsertContextNote(projectId, { id: existingId, category, title, body, pinned: false }, author);
}

type Author = { kind: "mcp" | "agent" | "user"; userId?: string | null };

/** Applies patch ops in order (validated up front). Returns the number of applied ops. */
export async function applyContextPatch(projectId: string, ops: ContextPatchOp[], author: Author): Promise<number> {
  let applied = 0;
  for (const op of ops) {
    const notes = await listContextNotes(projectId);
    try {
      switch (op.op) {
        case "set_section": {
          const label = CONTEXT_CATEGORY_LABELS[op.section];
          const existing = canonicalNote(notes, op.section, label) ?? notes.find((n) => n.category === op.section);
          if (!op.content.trim()) {
            if (existing) await deleteContextNote(projectId, existing.id);
          } else {
            await upsertContextNote(projectId, { id: existing?.id, category: op.section, title: existing?.title ?? label, body: op.content, pinned: existing?.pinned }, author);
          }
          break;
        }
        case "add_competitors":
        case "remove_competitors": {
          const note = canonicalNote(notes, "competitors", COMPETITORS_TITLE);
          const map = new Map((note ? parseCompetitors(note.body) : []).map((c) => [c.domain, c]));
          if (op.op === "add_competitors") {
            for (const c of op.competitors) {
              const domain = normalizeDomain(c.domain);
              if (!domain) continue;
              const cur = map.get(domain);
              map.set(domain, { domain, name: c.name ?? cur?.name ?? null, notes: c.notes ?? cur?.notes ?? null });
            }
            if (map.size > LIST_MAX) throw new ApiError("validation_error", `At most ${LIST_MAX} competitors.`);
          } else {
            for (const d of op.domains) map.delete(normalizeDomain(d));
          }
          await saveListNote(projectId, note?.id, "competitors", COMPETITORS_TITLE, renderCompetitors([...map.values()]), author);
          break;
        }
        case "add_key_pages":
        case "remove_key_pages": {
          const note = canonicalNote(notes, "key_pages", KEY_PAGES_TITLE);
          const map = new Map((note ? parseKeyPages(note.body) : []).map((p) => [p.url, p]));
          if (op.op === "add_key_pages") {
            for (const p of op.pages) {
              const cur = map.get(p.url);
              map.set(p.url, { url: p.url, role: p.role ?? cur?.role ?? null, topic: p.topic ?? cur?.topic ?? null, notes: p.notes ?? cur?.notes ?? null });
            }
            if (map.size > LIST_MAX) throw new ApiError("validation_error", `At most ${LIST_MAX} key pages.`);
          } else {
            for (const u of op.urls) map.delete(u);
          }
          await saveListNote(projectId, note?.id, "key_pages", KEY_PAGES_TITLE, renderKeyPages([...map.values()]), author);
          break;
        }
        case "append_research_log":
          await appendResearchLog(projectId, op.summary, author.kind, author.userId ?? null);
          break;
        case "remove_research_log":
          for (const id of op.ids) {
            if (notes.some((n) => n.id === id && n.category === "research_log")) await deleteContextNote(projectId, id);
          }
          break;
        case "upsert_note":
          await upsertContextNote(projectId, { id: op.id, category: op.category, title: op.title, body: op.body, pinned: op.pinned }, author);
          break;
        case "delete_note":
          await deleteContextNote(projectId, op.id);
          break;
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("validation_error", `${err instanceof Error ? err.message : "Update failed"} (op ${applied + 1}: ${op.op}; ${applied} applied).`);
    }
    applied++;
  }
  return applied;
}
