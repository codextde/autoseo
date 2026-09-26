import "server-only";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projectContextNotes } from "@/server/db/schema";
import { CONTEXT_CATEGORY_LABELS, type ContextCategory, type ContextNote } from "@/features/ai-research/types";

/**
 * Project context ("memory") shared by humans and agents — open-seo §13 equivalent.
 * Agents / MCP read `getProjectContextMarkdown()` and write via `upsertContextNote()` /
 * `appendResearchLog()` with `author` = "agent" | "mcp".
 */

export const MAX_CONTEXT_NOTES = 200;
export const MAX_NOTE_CHARS = 8000;

export const contextNoteInput = z.object({
  id: z.string().max(40).optional(),
  category: z.enum(["business_overview", "goal", "positioning", "audience", "writing", "competitors", "key_pages", "research_log", "other"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(MAX_NOTE_CHARS),
  pinned: z.boolean().optional(),
});

export type ContextNoteInput = z.infer<typeof contextNoteInput>;

function toNote(r: typeof projectContextNotes.$inferSelect): ContextNote {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    pinned: r.pinned,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listContextNotes(projectId: string): Promise<ContextNote[]> {
  const rows = await db
    .select()
    .from(projectContextNotes)
    .where(eq(projectContextNotes.projectId, projectId))
    .orderBy(desc(projectContextNotes.pinned), asc(projectContextNotes.category), desc(projectContextNotes.updatedAt));
  return rows.map(toNote);
}

export async function upsertContextNote(
  projectId: string,
  input: ContextNoteInput,
  author: { kind: "user" | "agent" | "mcp"; userId?: string | null },
): Promise<ContextNote> {
  const data = contextNoteInput.parse(input);
  if (data.id) {
    const [row] = await db
      .update(projectContextNotes)
      .set({ category: data.category, title: data.title, body: data.body, pinned: data.pinned ?? false, updatedBy: author.kind })
      .where(and(eq(projectContextNotes.id, data.id), eq(projectContextNotes.projectId, projectId)))
      .returning();
    if (!row) throw new Error("Note not found.");
    return toNote(row);
  }
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(projectContextNotes).where(eq(projectContextNotes.projectId, projectId));
  if (n >= MAX_CONTEXT_NOTES) throw new Error(`A project can have at most ${MAX_CONTEXT_NOTES} context notes.`);
  const [row] = await db
    .insert(projectContextNotes)
    .values({
      projectId,
      category: data.category,
      title: data.title,
      body: data.body,
      pinned: data.pinned ?? false,
      updatedBy: author.kind,
      createdBy: author.userId ?? null,
    })
    .returning();
  return toNote(row!);
}

export async function deleteContextNote(projectId: string, id: string) {
  await db.delete(projectContextNotes).where(and(eq(projectContextNotes.id, id), eq(projectContextNotes.projectId, projectId)));
}

/** Appends a dated research-log entry (used by agents after finishing research). */
export async function appendResearchLog(projectId: string, summary: string, author: "user" | "agent" | "mcp" = "agent", userId?: string | null) {
  const date = new Date().toISOString().slice(0, 10);
  return upsertContextNote(projectId, { category: "research_log", title: `${date}: ${summary.slice(0, 120)}`, body: summary.slice(0, MAX_NOTE_CHARS) }, { kind: author, userId });
}

/** Markdown digest for agents (read-only context block). */
export async function getProjectContextMarkdown(projectId: string): Promise<string> {
  const notes = await listContextNotes(projectId);
  const out: string[] = ["# Project context"];
  const cats = Object.keys(CONTEXT_CATEGORY_LABELS) as ContextCategory[];
  for (const cat of cats) {
    const list = notes.filter((n) => n.category === cat);
    if (!list.length) continue;
    out.push(`\n## ${CONTEXT_CATEGORY_LABELS[cat]}`);
    for (const n of cat === "research_log" ? list.slice(0, 20) : list) {
      out.push(`\n### ${n.title}${n.pinned ? " (pinned)" : ""}\n${n.body.trim()}\n_Updated by ${n.updatedBy} · ${n.updatedAt.slice(0, 10)}_`);
    }
  }
  const missing = (["business_overview", "goal", "positioning", "writing"] as ContextCategory[]).filter((c) => !notes.some((n) => n.category === c));
  out.push(`\nMissing sections: ${missing.length ? missing.map((m) => CONTEXT_CATEGORY_LABELS[m]).join(", ") : "none"}`);
  return out.join("\n");
}
