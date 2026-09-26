import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chatAttachments, chatFeedback, chatMessages, chats, projects, usageEvents } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { partsText } from "@/features/chat/lib/parts";
import type {
  ChatMessageView,
  ChatPart,
  ChatRuntimeInfo,
  ChatSearchHit,
  ChatSummary,
  ChatUsageInfo,
  ChatUsageMeter,
} from "@/features/chat/types";
import { deleteAttachmentFiles } from "./attachments";

export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;

export function toMessageView(row: MessageRow, feedback: "up" | "down" | null = null): ChatMessageView {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    parts: row.parts ?? [],
    status: row.status,
    error: row.error,
    runtime: row.runtime ?? null,
    modelSelection: row.modelSelection,
    usage: row.usage ?? null,
    feedback,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSummary(row: ChatRow, streaming = false): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    streaming,
  };
}

/** Provisional title from the first user message (replaced by the AI title job). */
export function provisionalTitle(text: string, fallback = "New chat"): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

/* ───────────────────────────── Chats ───────────────────────────── */

export async function getChat(projectId: string, userId: string, chatId: string): Promise<ChatRow | null> {
  const [row] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.projectId, projectId), eq(chats.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createChat(input: { projectId: string; userId: string; title: string; modelSelection: string }): Promise<ChatRow> {
  const [row] = await db
    .insert(chats)
    .values({ projectId: input.projectId, userId: input.userId, title: input.title, modelSelection: input.modelSelection })
    .returning();
  return row!;
}

async function streamingChatIds(chatIds: string[]): Promise<Set<string>> {
  if (!chatIds.length) return new Set();
  const rows = await db
    .selectDistinct({ chatId: chatMessages.chatId })
    .from(chatMessages)
    .where(and(inArray(chatMessages.chatId, chatIds), eq(chatMessages.status, "streaming")));
  return new Set(rows.map((r) => r.chatId));
}

export async function listChats(projectId: string, userId: string, limit = 200): Promise<ChatSummary[]> {
  const rows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.projectId, projectId), eq(chats.userId, userId)))
    .orderBy(desc(chats.pinned), desc(chats.lastMessageAt))
    .limit(limit);
  const streaming = await streamingChatIds(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, streaming.has(r.id)));
}

function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function snippetAround(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return null;
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + q.length + 90);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Searches chat titles and message contents of the user's chats in this project. */
export async function searchChats(projectId: string, userId: string, q: string, limit = 30): Promise<ChatSearchHit[]> {
  const term = q.trim().slice(0, 200);
  if (!term) return (await listChats(projectId, userId, limit)).map((c) => ({ ...c, snippet: null }));
  const pattern = `%${escapeLike(term)}%`;
  const matches = await db
    .select({ chatId: chatMessages.chatId, content: chatMessages.content, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .where(and(eq(chats.projectId, projectId), eq(chats.userId, userId), ilike(chatMessages.content, pattern)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(200);
  const snippetByChat = new Map<string, string>();
  for (const m of matches) if (!snippetByChat.has(m.chatId)) snippetByChat.set(m.chatId, snippetAround(m.content, term) ?? "");
  const rows = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.projectId, projectId),
        eq(chats.userId, userId),
        or(ilike(chats.title, pattern), snippetByChat.size ? inArray(chats.id, [...snippetByChat.keys()]) : sql`false`),
      ),
    )
    .orderBy(desc(chats.lastMessageAt))
    .limit(limit);
  return rows.map((r) => ({ ...toSummary(r), snippet: snippetByChat.get(r.id) || null }));
}

export async function renameChat(projectId: string, userId: string, chatId: string, title: string) {
  const [row] = await db
    .update(chats)
    .set({ title: title.trim().slice(0, 120) || "New chat", titleSource: "user" })
    .where(and(eq(chats.id, chatId), eq(chats.projectId, projectId), eq(chats.userId, userId)))
    .returning();
  return row ?? null;
}

export async function setChatTitleIfProvisional(chatId: string, title: string) {
  await db
    .update(chats)
    .set({ title: title.slice(0, 120), titleSource: "auto" })
    .where(and(eq(chats.id, chatId), eq(chats.titleSource, "provisional")));
}

export async function pinChat(projectId: string, userId: string, chatId: string, pinned: boolean) {
  const [row] = await db
    .update(chats)
    .set({ pinned })
    .where(and(eq(chats.id, chatId), eq(chats.projectId, projectId), eq(chats.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteChat(projectId: string, userId: string, chatId: string): Promise<boolean> {
  const chat = await getChat(projectId, userId, chatId);
  if (!chat) return false;
  const files = await db
    .select({ projectId: chatAttachments.projectId, storageName: chatAttachments.storageName })
    .from(chatAttachments)
    .where(eq(chatAttachments.chatId, chatId));
  await db.delete(chats).where(eq(chats.id, chatId));
  await deleteAttachmentFiles(files);
  return true;
}

export async function touchChat(chatId: string, patch: { modelSelection?: string; messageDelta?: number } = {}) {
  await db
    .update(chats)
    .set({
      lastMessageAt: new Date(),
      ...(patch.modelSelection ? { modelSelection: patch.modelSelection } : {}),
      ...(patch.messageDelta ? { messageCount: sql`${chats.messageCount} + ${patch.messageDelta}` } : {}),
    })
    .where(eq(chats.id, chatId));
}

/* ───────────────────────────── Messages ───────────────────────────── */

export async function listMessages(chatId: string, userId: string): Promise<ChatMessageView[]> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  if (!rows.length) return [];
  const fb = await db
    .select({ messageId: chatFeedback.messageId, rating: chatFeedback.rating })
    .from(chatFeedback)
    .where(and(eq(chatFeedback.chatId, chatId), eq(chatFeedback.userId, userId)));
  const ratings = new Map(fb.map((f) => [f.messageId, f.rating]));
  return rows.map((r) => toMessageView(r, ratings.get(r.id) ?? null));
}

export async function listMessageRows(chatId: string): Promise<MessageRow[]> {
  return db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

export async function getMessage(messageId: string): Promise<MessageRow | null> {
  const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
  return row ?? null;
}

export async function insertMessage(input: {
  chatId: string;
  projectId: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  status?: MessageRow["status"];
  modelSelection?: string | null;
  createdAt?: Date;
}): Promise<MessageRow> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      chatId: input.chatId,
      projectId: input.projectId,
      role: input.role,
      parts: input.parts,
      content: partsText(input.parts),
      status: input.status ?? "complete",
      modelSelection: input.modelSelection ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();
  return row!;
}

export async function updateMessage(
  id: string,
  patch: {
    parts?: ChatPart[];
    status?: MessageRow["status"];
    error?: string | null;
    runtime?: ChatRuntimeInfo | null;
    usage?: ChatUsageInfo | null;
  },
): Promise<MessageRow | null> {
  const [row] = await db
    .update(chatMessages)
    .set({
      ...(patch.parts ? { parts: patch.parts, content: partsText(patch.parts) } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.runtime !== undefined ? { runtime: patch.runtime } : {}),
      ...(patch.usage !== undefined ? { usage: patch.usage } : {}),
    })
    .where(eq(chatMessages.id, id))
    .returning();
  return row ?? null;
}

/**
 * Deletes every message that comes after `after` in the chat (regenerate / edit & resend). Ordering
 * is taken from the database (microsecond timestamps), never compared against JS Dates (ms).
 */
export async function deleteMessagesAfter(chatId: string, after: Pick<MessageRow, "id">) {
  const rows = await listMessageRows(chatId);
  const idx = rows.findIndex((r) => r.id === after.id);
  const later = idx === -1 ? [] : rows.slice(idx + 1);
  if (!later.length) return 0;
  await db.delete(chatMessages).where(inArray(chatMessages.id, later.map((r) => r.id)));
  await db
    .update(chats)
    .set({ messageCount: sql`greatest(${chats.messageCount} - ${later.length}, 0)` })
    .where(eq(chats.id, chatId));
  return later.length;
}

/** Messages left "streaming" by a crashed / restarted server are marked as interrupted. */
export async function failStaleStreaming(olderThanMs: number, activeIds: Set<string>): Promise<number> {
  const rows = await db
    .select({ id: chatMessages.id, parts: chatMessages.parts })
    .from(chatMessages)
    .where(and(eq(chatMessages.status, "streaming"), lt(chatMessages.updatedAt, new Date(Date.now() - olderThanMs))))
    .limit(200);
  let n = 0;
  for (const r of rows) {
    if (activeIds.has(r.id)) continue;
    await updateMessage(r.id, { status: "error", error: "The answer was interrupted (the server restarted). Retry to generate it again." });
    n++;
  }
  return n;
}

/* ───────────────────────────── Feedback ───────────────────────────── */

export async function setFeedback(input: {
  projectId: string;
  userId: string;
  messageId: string;
  rating: "up" | "down" | null;
  comment?: string | null;
}): Promise<boolean> {
  const [msg] = await db
    .select({ id: chatMessages.id, chatId: chatMessages.chatId, role: chatMessages.role })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .where(and(eq(chatMessages.id, input.messageId), eq(chats.projectId, input.projectId), eq(chats.userId, input.userId)))
    .limit(1);
  if (!msg || msg.role !== "assistant") return false;
  if (input.rating === null) {
    await db.delete(chatFeedback).where(and(eq(chatFeedback.messageId, msg.id), eq(chatFeedback.userId, input.userId)));
    return true;
  }
  await db
    .insert(chatFeedback)
    .values({ messageId: msg.id, chatId: msg.chatId, projectId: input.projectId, userId: input.userId, rating: input.rating, comment: input.comment ?? null })
    .onConflictDoUpdate({
      target: [chatFeedback.messageId, chatFeedback.userId],
      set: { rating: input.rating, comment: input.comment ?? null, updatedAt: new Date() },
    });
  return true;
}

/* ───────────────────────────── Usage meter ───────────────────────────── */

/** AI usage of the workspace this month: local agent runs vs paid API calls (+ this user's chat split). */
export async function getUsageMeter(workspaceId: string, userId: string): Promise<ChatUsageMeter> {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const inWorkspace = or(
    eq(usageEvents.workspaceId, workspaceId),
    inArray(usageEvents.projectId, db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId))),
  );
  const [agg] = await db
    .select({
      agentRuns: sql<number>`count(*) filter (where ${usageEvents.provider} = 'local_agent')::int`,
      apiCalls: sql<number>`count(*) filter (where ${usageEvents.provider} in ('anthropic','openai','openrouter'))::int`,
      apiCost: sql<number>`coalesce(sum(${usageEvents.costUsd}) filter (where ${usageEvents.provider} in ('anthropic','openai','openrouter')), 0)::float8`,
      chatAgent: sql<number>`count(*) filter (where ${usageEvents.feature} = 'agent_chat' and ${usageEvents.userId} = ${userId} and ${usageEvents.provider} = 'local_agent')::int`,
      chatApi: sql<number>`count(*) filter (where ${usageEvents.feature} = 'agent_chat' and ${usageEvents.userId} = ${userId} and ${usageEvents.provider} in ('anthropic','openai','openrouter'))::int`,
    })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, month), inWorkspace));
  const limits = await getSetting("limits");
  return {
    monthLabel: month.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
    agentRuns: agg?.agentRuns ?? 0,
    apiCalls: agg?.apiCalls ?? 0,
    apiCostUsd: Number(agg?.apiCost ?? 0),
    budgetUsd: limits.monthlyBudgetUsd > 0 ? limits.monthlyBudgetUsd : null,
    chatAgentMessages: agg?.chatAgent ?? 0,
    chatApiMessages: agg?.chatApi ?? 0,
  };
}
