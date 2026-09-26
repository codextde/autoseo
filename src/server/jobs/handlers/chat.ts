import "server-only";
// Job handlers + schedules for the "chat" module (Agent mode).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chats, projects } from "@/server/db/schema";
import { AiNotConfiguredError, runLlm } from "@/server/ai/llm";
import { cleanupOrphanAttachments } from "@/server/chat/attachments";
import { activeRunIds } from "@/server/chat/runs";
import { failStaleStreaming, listMessageRows, setChatTitleIfProvisional } from "@/server/chat/store";
import { partsText } from "@/features/chat/lib/parts";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";

const titleSchema = z.object({ title: z.string().min(1).max(120) });

/** Short AI title for a new chat (after its first answer). Keeps the provisional title on failure. */
defineJob<{ chatId: string }>({
  type: "chat.title",
  concurrency: 2,
  retryable: false,
  timeoutMs: 3 * 60_000,
  run: async ({ chatId }) => {
    const [chat] = await db
      .select({ id: chats.id, titleSource: chats.titleSource, projectId: chats.projectId, userId: chats.userId, workspaceId: projects.workspaceId })
      .from(chats)
      .innerJoin(projects, eq(projects.id, chats.projectId))
      .where(eq(chats.id, chatId))
      .limit(1);
    if (!chat || chat.titleSource !== "provisional") return { skipped: true };
    const rows = await listMessageRows(chatId);
    const user = rows.find((r) => r.role === "user");
    const assistant = rows.find((r) => r.role === "assistant" && r.status === "complete");
    const question = user ? partsText(user.parts) : "";
    if (!question) return { skipped: true };
    try {
      const res = await runLlm({
        purpose: "chat_title",
        system: "You name chat conversations. Answer with JSON only.",
        prompt: [
          "Write a short, specific title (3–6 words, no quotes, no trailing punctuation, sentence case) for this conversation, in the language of the user's message.",
          "",
          `User: ${question.slice(0, 1500)}`,
          assistant ? `Assistant: ${partsText(assistant.parts).slice(0, 1500)}` : "",
        ].join("\n"),
        schema: titleSchema,
        effort: "low",
        maxTokens: 2000,
        timeoutMs: 120_000,
        projectId: chat.projectId,
        workspaceId: chat.workspaceId,
        userId: chat.userId,
      });
      const title = res.data.title.replace(/^["'“”]+|["'“”.]+$/g, "").trim();
      if (title) await setChatTitleIfProvisional(chatId, title);
      return { title };
    } catch (err) {
      if (err instanceof AiNotConfiguredError) return { skipped: true, reason: "ai_not_configured" };
      throw err;
    }
  },
});

/** Hourly: drop never-sent uploads (>24h) and mark answers orphaned by a restart as interrupted. */
defineSchedule({
  name: "chat.cleanup",
  cron: "23 * * * *",
  tick: async () => {
    await enqueueJob("chat.cleanup", {}, { dedupeKey: "chat.cleanup", maxAttempts: 1 });
  },
});

defineJob<Record<string, never>>({
  type: "chat.cleanup",
  concurrency: 1,
  retryable: false,
  run: async () => {
    const attachments = await cleanupOrphanAttachments();
    const interrupted = await failStaleStreaming(10 * 60_000, activeRunIds());
    return { attachments, interrupted };
  },
});
