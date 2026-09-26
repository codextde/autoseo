"use server";

import { z } from "zod";
import { ActionError, actionProject, runAction } from "@/server/auth/guards";
import { deleteChat, pinChat, renameChat, setFeedback, toSummary } from "@/server/chat/store";
import { getRun, stopRun } from "@/server/chat/runs";
import { listMessageRows } from "@/server/chat/store";

const pid = z.string().min(3).max(64);
const cid = z.string().min(3).max(64);

export async function renameChatAction(projectId: string, chatId: string, title: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    const t = z.string().trim().min(1, "Give the chat a name.").max(120).parse(title);
    const row = await renameChat(ctx.project.id, ctx.user.id, cid.parse(chatId), t);
    if (!row) throw new ActionError("Chat not found.", "not_found");
    return toSummary(row);
  });
}

export async function pinChatAction(projectId: string, chatId: string, pinned: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    const row = await pinChat(ctx.project.id, ctx.user.id, cid.parse(chatId), z.boolean().parse(pinned));
    if (!row) throw new ActionError("Chat not found.", "not_found");
    return toSummary(row);
  });
}

export async function deleteChatAction(projectId: string, chatId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    const id = cid.parse(chatId);
    // Stop a running answer first so it does not write into a deleted chat.
    for (const m of await listMessageRows(id)) if (m.status === "streaming" && getRun(m.id)) stopRun(m.id, ctx.user.id);
    const ok = await deleteChat(ctx.project.id, ctx.user.id, id);
    if (!ok) throw new ActionError("Chat not found.", "not_found");
    return { deleted: true };
  });
}

export async function chatFeedbackAction(projectId: string, messageId: string, rating: "up" | "down" | null, comment?: string | null) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    const ok = await setFeedback({
      projectId: ctx.project.id,
      userId: ctx.user.id,
      messageId: cid.parse(messageId),
      rating: z.enum(["up", "down"]).nullable().parse(rating),
      comment: z.string().trim().max(2000).nullish().parse(comment) ?? null,
    });
    if (!ok) throw new ActionError("Message not found.", "not_found");
    return { rating };
  });
}
