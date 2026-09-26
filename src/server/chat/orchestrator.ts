import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chatAttachments, chatMessages, chats } from "@/server/db/schema";
import type { ProjectContext } from "@/server/auth/context";
import { getSetting } from "@/server/settings";
import { assertBudget, BudgetExceededError, recordUsage } from "@/server/usage";
import { enqueueJob } from "@/server/jobs/queue";
import { partsText, settleRunningTools } from "@/features/chat/lib/parts";
import type { ChatMessageView, ChatPart, ChatStreamEvent, ChatSummary } from "@/features/chat/types";
import {
  bindAttachmentsToMessage,
  claimAttachments,
  loadAttachments,
  toAttachmentRef,
  type AttachmentRow,
} from "./attachments";
import { buildSystemPrompt } from "./context";
import { getAvailability, parseSelection, providerLabel, type ApiProvider } from "./models";
import { activeRunsForUser, getRun, publish, registerRun, snapshot, type ChatRun } from "./runs";
import {
  createChat,
  deleteMessagesAfter,
  getChat,
  insertMessage,
  listMessageRows,
  provisionalTitle,
  toMessageView,
  toSummary,
  touchChat,
  updateMessage,
  type ChatRow,
  type MessageRow,
} from "./store";
import { chatPrincipal, chatToolSpecs, executeChatTool, lockedTools, type ChatActor } from "./tools";
import { runAgentTurn } from "./providers/agent";
import { runAnthropicTurn } from "./providers/anthropic";
import { runOpenAiTurn } from "./providers/openai";
import { ChatAbortedError, ProviderUnavailableError, type ProviderOutcome, type ProviderTurn, type TranscriptMessage } from "./providers/types";

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const MAX_ACTIVE_RUNS_PER_USER = 3;

export function actorFromContext(ctx: ProjectContext): ChatActor {
  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
    workspace: { id: ctx.membership.workspace.id, name: ctx.membership.workspace.name, slug: ctx.membership.workspace.slug },
    roleKey: ctx.membership.roleKey,
    permissions: ctx.permissions,
    allProjects: ctx.membership.allProjects,
    projectId: ctx.project.id,
  };
}

export type SendInput = {
  ctx: ProjectContext;
  chatId: string | null;
  mode: "send" | "regenerate" | "edit";
  text: string;
  attachmentIds: string[];
  selection: string;
  /** edit: the user message being edited. regenerate: the assistant message being replaced. */
  targetMessageId?: string | null;
};

export type SendResult = { chat: ChatSummary; userMessage: ChatMessageView | null; assistantMessage: ChatMessageView };

/** Persists the user turn, creates the assistant placeholder and starts the answer in the background. */
export async function sendChatMessage(input: SendInput): Promise<SendResult> {
  const { ctx } = input;
  if (!ctx.permissions.has("prompts.manage")) throw new ChatError("You have read-only access to this project.", 403);
  if (activeRunsForUser(ctx.user.id) >= MAX_ACTIVE_RUNS_PER_USER) {
    throw new ChatError("You already have several answers running. Wait for one to finish or stop it.", 429);
  }

  let chat: ChatRow | null = null;
  if (input.chatId) {
    chat = await getChat(ctx.project.id, ctx.user.id, input.chatId);
    if (!chat) throw new ChatError("Chat not found.", 404);
  } else {
    if (input.mode !== "send") throw new ChatError("Nothing to regenerate.");
    chat = await createChat({
      projectId: ctx.project.id,
      userId: ctx.user.id,
      title: provisionalTitle(input.text, input.attachmentIds.length ? "Attachment" : "New chat"),
      modelSelection: input.selection,
    });
  }

  const rows = await listMessageRows(chat.id);
  if (rows.some((r) => r.status === "streaming" && getRun(r.id))) throw new ChatError("An answer is still being generated in this chat.", 409);

  let userRow: MessageRow | null = null;
  if (input.mode === "send") {
    if (!input.text.trim() && !input.attachmentIds.length) throw new ChatError("Type a message first.");
    const atts = await claimAttachments(ctx.project.id, ctx.user.id, chat.id, input.attachmentIds);
    const parts: ChatPart[] = [...atts.map((a) => ({ type: "attachment" as const, attachment: toAttachmentRef(a) }))];
    if (input.text.trim()) parts.push({ type: "text", text: input.text.trim() });
    userRow = await insertMessage({ chatId: chat.id, projectId: ctx.project.id, role: "user", parts });
    await bindAttachmentsToMessage(atts.map((a) => a.id), userRow.id);
  } else if (input.mode === "regenerate") {
    const lastUserIdx = rows.findLastIndex((r) => r.role === "user");
    const lastUser = rows[lastUserIdx];
    if (!lastUser) throw new ChatError("Nothing to regenerate.");
    if (input.targetMessageId && !rows.slice(lastUserIdx + 1).some((r) => r.id === input.targetMessageId && r.role === "assistant")) {
      throw new ChatError("Only the latest answer can be regenerated.");
    }
    await deleteMessagesAfter(chat.id, lastUser);
  } else {
    const lastUser = [...rows].reverse().find((r) => r.role === "user");
    if (!lastUser || lastUser.id !== input.targetMessageId) throw new ChatError("Only your latest message can be edited.");
    if (!input.text.trim()) throw new ChatError("The message cannot be empty.");
    const parts: ChatPart[] = [...lastUser.parts.filter((p) => p.type === "attachment"), { type: "text", text: input.text.trim() }];
    userRow = await updateMessage(lastUser.id, { parts });
    await deleteMessagesAfter(chat.id, lastUser);
  }

  const assistantRow = await insertMessage({
    chatId: chat.id,
    projectId: ctx.project.id,
    role: "assistant",
    parts: [],
    status: "streaming",
    modelSelection: input.selection,
  });
  await touchChat(chat.id, { modelSelection: input.selection, messageDelta: input.mode === "send" ? 2 : 1 });

  const run = registerRun({
    messageId: assistantRow.id,
    chatId: chat.id,
    projectId: ctx.project.id,
    userId: ctx.user.id,
    modelSelection: input.selection,
    createdAt: assistantRow.createdAt.toISOString(),
  });
  const actor = actorFromContext(ctx);
  void executeTurn(run, { actor, ctx, chat }).catch((err) => console.error("[chat] turn crashed", err));

  return {
    chat: toSummary({ ...chat, lastMessageAt: new Date() }, true),
    userMessage: userRow ? toMessageView(userRow) : null,
    assistantMessage: toMessageView(assistantRow),
  };
}

/* ───────────────────────────── Turn execution ───────────────────────────── */

async function buildTranscript(chatId: string, excludeId: string): Promise<TranscriptMessage[]> {
  const rows = (await listMessageRows(chatId)).filter((r) => r.id !== excludeId);
  const userIds = rows.filter((r) => r.role === "user").map((r) => r.id);
  const atts: AttachmentRow[] = userIds.length ? await db.select().from(chatAttachments).where(inArray(chatAttachments.messageId, userIds)) : [];
  const loaded = await loadAttachments(atts);
  const byMessage = new Map<string, typeof loaded>();
  for (const a of loaded) {
    const row = atts.find((r) => r.id === a.ref.id);
    if (!row?.messageId) continue;
    byMessage.set(row.messageId, [...(byMessage.get(row.messageId) ?? []), a]);
  }
  return rows
    .filter((r) => r.role === "user" || (r.status !== "streaming" && partsText(r.parts)))
    .map((r) => ({ role: r.role, text: r.role === "user" ? partsText(r.parts) : partsText(r.parts), attachments: byMessage.get(r.id) ?? [] }));
}

function friendlyError(err: unknown): string {
  if (err instanceof BudgetExceededError) return `${err.message} Ask an admin to raise it in Admin → Limits & Budgets.`;
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check Admin → AI Providers.";
  if (err instanceof OpenAI.AuthenticationError) return "The API key was rejected by the provider. Check Admin → AI Providers.";
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) return "The AI provider is rate limiting requests right now. Try again in a minute.";
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) return `The AI provider returned an error: ${err.message}`;
  return err instanceof Error ? err.message : "Something went wrong while answering.";
}

type TurnDeps = { actor: ChatActor; ctx: ProjectContext; chat: ChatRow };

export async function executeTurn(run: ChatRun, deps: TurnDeps) {
  const { actor, ctx, chat } = deps;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<unknown> = Promise.resolve();
  const flush = () => {
    flushTimer = null;
    flushing = flushing.then(() => updateMessage(run.messageId, { parts: run.parts, runtime: run.runtime }).catch(() => null));
  };
  const emit = (ev: ChatStreamEvent) => {
    publish(run, ev);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 1200);
      flushTimer.unref?.();
    }
  };

  let outcome: ProviderOutcome | null = null;
  let status: "complete" | "stopped" | "error" = "complete";
  let error: string | null = null;
  try {
    outcome = await answer(run, deps, emit);
  } catch (err) {
    if (err instanceof ChatAbortedError || run.abort.signal.aborted) {
      status = "stopped";
    } else {
      status = "error";
      error = friendlyError(err);
      if (!(err instanceof ProviderUnavailableError) && !(err instanceof BudgetExceededError)) console.error("[chat] turn failed", err);
    }
  }
  if (flushTimer) clearTimeout(flushTimer);
  await flushing;

  const parts = settleRunningTools(run.parts, status === "stopped" ? "Stopped" : "Not finished");
  const row = await updateMessage(run.messageId, {
    parts,
    status,
    error,
    runtime: outcome?.runtime ?? run.runtime,
    usage: outcome ? outcome.usage : null,
  });
  await touchChat(chat.id).catch(() => {});
  if (outcome) {
    await recordUsage({
      provider: outcome.runtime.kind === "agent" ? "local_agent" : outcome.runtime.provider,
      feature: "agent_chat",
      endpoint: outcome.runtime.model ?? outcome.runtime.provider,
      units: outcome.units,
      costUsd: outcome.costUsd,
      projectId: ctx.project.id,
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      meta: { chatId: chat.id, messageId: run.messageId, ...(outcome.runtime.agentId ? { agentId: outcome.runtime.agentId } : {}) },
    });
  }
  if (status === "complete" && chat.titleSource === "provisional") {
    await enqueueJob("chat.title", { chatId: chat.id }, { dedupeKey: `chat.title:${chat.id}`, maxAttempts: 1, projectId: ctx.project.id, createdBy: actor.user.id }).catch(
      () => null,
    );
  }
  const final = row ? toMessageView(row) : { ...snapshot(run), parts, status, error };
  publish(run, { type: "done", message: final });
}

async function answer(run: ChatRun, deps: TurnDeps, emit: (ev: ChatStreamEvent) => void): Promise<ProviderOutcome> {
  const { actor, ctx } = deps;
  const principal = chatPrincipal(actor);
  const plan = parseSelection(run.modelSelection);
  const [avail, ai] = await Promise.all([getAvailability(actor.workspace.id, actor.user.id), getSetting("ai")]);

  type Attempt = { label: string; kind: "agent" | "api"; provider: string; model: string | null; run: (turn: ProviderTurn) => Promise<ProviderOutcome> };
  const apiAttempt = (p: ApiProvider): Attempt => ({
    label: `${providerLabel(p)} (${avail.models[p]})`,
    kind: "api",
    provider: p,
    model: avail.models[p],
    run: (turn) =>
      p === "anthropic"
        ? runAnthropicTurn(turn, { apiKey: ai.anthropicApiKey, model: ai.anthropicModel })
        : runOpenAiTurn(turn, { provider: p, apiKey: p === "openai" ? ai.openaiApiKey : ai.openrouterApiKey, model: p === "openai" ? ai.openaiModel : ai.openrouterModel }),
  });
  const agentAttempt = (runtime: "claude" | "codex" | "any"): Attempt => ({
    label: runtime === "codex" ? "Codex" : runtime === "claude" ? "Claude Code" : "your local agent",
    kind: "agent",
    provider: runtime === "any" ? "claude" : runtime,
    model: null,
    run: (turn) =>
      runAgentTurn(turn, {
        runtime,
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
        projectId: actor.projectId,
        projectName: ctx.project.name,
        scopes: [...principal.scopes],
      }),
  });

  // Local agents only ever run the chat on the requesting user's own agent; otherwise the API answers.
  const attempts: Attempt[] = [];
  let skippedAgent: string | null = null;
  if (plan.kind === "api") {
    if (!avail.keys[plan.provider]) throw new ChatError(`No ${providerLabel(plan.provider)} key is configured. Add one in Admin → AI Providers or pick another model.`);
    attempts.push(apiAttempt(plan.provider));
  } else {
    const ownOnline = plan.kind === "agent" ? (plan.runtime === "claude" ? avail.claudeOnline : avail.codexOnline) : avail.claudeOnline || avail.codexOnline;
    const wantAgent = plan.kind === "agent" || avail.preferLocalAgent;
    if (wantAgent && avail.agentsEnabled && ownOnline) attempts.push(agentAttempt(plan.kind === "agent" ? plan.runtime : "any"));
    else if (plan.kind === "agent") skippedAgent = plan.runtime === "codex" ? "Codex" : "Claude Code";
    for (const p of avail.fallbackOrder) if (avail.keys[p]) attempts.push(apiAttempt(p));
  }
  if (!attempts.length) {
    throw new ChatError(
      avail.agentInstalled
        ? "Your local agent is offline and no API key is configured. Start your agent (Local Agents) or ask an admin to add an API key in Admin → AI Providers."
        : "No AI provider is available. Install a local agent to use Claude Code / Codex (Local Agents), or ask an admin to add an API key in Admin → AI Providers.",
    );
  }
  if (skippedAgent) {
    emit({
      type: "notice",
      tone: "info",
      text: `${skippedAgent} isn't available: ${avail.agentInstalled ? "your local agent is offline" : "install a local agent under Local Agents to use it"}. Answering with ${attempts[0]!.label} instead.`,
    });
  }

  const tools = chatToolSpecs(principal);
  const system = await buildSystemPrompt({
    project: ctx.project,
    user: { name: actor.user.name, email: actor.user.email },
    roleName: ctx.membership.roleName,
    permissions: actor.permissions,
    lockedTools: lockedTools(principal),
  });
  const transcript = await buildTranscript(run.chatId, run.messageId);
  const turn: ProviderTurn = {
    system,
    transcript,
    tools,
    executeTool: (name, input) => executeChatTool(principal, actor.projectId, name, input),
    emit,
    signal: run.abort.signal,
  };

  let lastError: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    if (run.abort.signal.aborted) throw new ChatAbortedError();
    if (a.kind === "api") {
      await assertBudget();
      emit({ type: "status", phase: "running", text: `Answering with ${a.label}…`, runtime: { kind: "api", provider: a.provider, model: a.model } });
    }
    try {
      const out = await a.run(turn);
      emit({ type: "runtime", runtime: out.runtime });
      return out;
    } catch (err) {
      if (err instanceof ChatAbortedError || run.abort.signal.aborted) throw new ChatAbortedError();
      const hasOutput = run.parts.some((p) => p.type === "text" || p.type === "tool_call");
      if (!(err instanceof ProviderUnavailableError) || hasOutput || i === attempts.length - 1) throw err;
      lastError = err;
      const next = attempts[i + 1]!;
      emit({ type: "status", phase: "fallback", text: `Switching to ${next.label}…` });
      emit({ type: "notice", tone: "info", text: `${a.kind === "agent" ? "Local agent unavailable" : `${a.label} failed`}: ${err.message} — answering with ${next.label} instead.` });
    }
  }
  throw lastError ?? new Error("No provider answered.");
}

/** Chats of other users are never visible; this is used by the SSE endpoint to authorize a run. */
export async function ownsMessage(userId: string, projectId: string, messageId: string): Promise<{ chatId: string } | null> {
  const run = getRun(messageId);
  if (run) return run.userId === userId && run.projectId === projectId ? { chatId: run.chatId } : null;
  const [row] = await db
    .select({ chatId: chatMessages.chatId, userId: chats.userId, projectId: chats.projectId })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  if (!row || row.userId !== userId || row.projectId !== projectId) return null;
  return { chatId: row.chatId };
}
