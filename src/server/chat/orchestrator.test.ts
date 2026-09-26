import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chats, jobs, projects, roles, usageEvents, users, workspaceMembers, workspaces } from "@/server/db/schema";
import type { ProjectContext } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";
import type { ChatMessageView, ChatStreamEvent } from "@/features/chat/types";
import type { ProviderTurn } from "./providers/types";

/**
 * Orchestrator integration test against the dev database with a stub model provider: persistence,
 * streaming fan-out, in-process tool execution scoped to the project, usage recording, regenerate /
 * edit / stop. (The real Anthropic loop is covered by anthropic-provider.test.ts.)
 */

const seen: ProviderTurn[] = [];
let behaviour: "answer" | "hang" = "answer";

vi.mock("./providers/anthropic", () => ({
  runAnthropicTurn: async (turn: ProviderTurn) => {
    seen.push(turn);
    if (behaviour === "hang") {
      turn.emit({ type: "text", delta: "Partial…" });
      await new Promise((_, reject) => turn.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
    turn.emit({ type: "thinking", delta: "Look up the context.", at: Date.now() });
    turn.emit({ type: "tool_call", id: "call_1", name: "get_project_context", title: "Get project context", input: {}, source: "autoseo", at: Date.now() });
    const res = await turn.executeTool("get_project_context", {});
    turn.emit({ type: "tool_result", id: "call_1", output: res.output, data: res.data ?? undefined, isError: res.isError, at: Date.now() });
    turn.emit({ type: "text", delta: `Answer for: ${turn.transcript[turn.transcript.length - 1]!.text}` });
    return {
      runtime: { kind: "api", provider: "anthropic", model: "stub-model" },
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001, steps: 2 },
      costUsd: 0.001,
      units: 15,
    };
  },
}));

vi.mock("./models", async (orig) => {
  const actual = await orig<typeof import("./models")>();
  return {
    ...actual,
    getAvailability: async () => ({
      agentsEnabled: false,
      preferLocalAgent: false,
      agentInstalled: false,
      claudeOnline: false,
      codexOnline: false,
      keys: { anthropic: true, openai: false, openrouter: false },
      models: { anthropic: "stub-model", openai: "gpt-5", openrouter: "x" },
      fallbackOrder: ["anthropic", "openai", "openrouter"],
    }),
  };
});

const { sendChatMessage } = await import("./orchestrator");
const { getRun, subscribe, stopRun } = await import("./runs");
const { getMessage, listMessageRows } = await import("./store");

const PROJECT_ID = "prj_demo0000000001";
let ctx: ProjectContext;
const createdChats: string[] = [];

async function loadContext(): Promise<ProjectContext | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, PROJECT_ID)).limit(1);
  if (!project) return null;
  const [member] = await db
    .select({ user: users, roleKey: workspaceMembers.roleKey, workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), eq(workspaceMembers.roleKey, "owner")))
    .limit(1);
  if (!member) return null;
  const [role] = await db.select().from(roles).where(eq(roles.key, member.roleKey)).limit(1);
  const permissions = new Set((role?.permissions ?? []) as Permission[]);
  const membership = { workspace: member.workspace, roleKey: member.roleKey, roleName: role?.name ?? "Owner", permissions, allProjects: true };
  return {
    user: member.user as unknown as ProjectContext["user"],
    sessionId: "ses_test",
    memberships: [membership],
    isInstanceAdmin: false,
    project,
    membership,
    permissions,
  };
}

function waitDone(messageId: string): Promise<ChatMessageView> {
  const run = getRun(messageId);
  if (!run) throw new Error("run not registered");
  if (run.final) return Promise.resolve(run.final);
  return new Promise((resolve) => {
    const off = subscribe(run, (ev: ChatStreamEvent) => {
      if (ev.type === "done") {
        off();
        resolve(ev.message);
      }
    });
  });
}

const maybe = await loadContext();
const suite = maybe ? describe : describe.skip;

beforeAll(() => {
  if (maybe) ctx = maybe;
});

afterAll(async () => {
  if (!createdChats.length) return;
  await db.delete(jobs).where(inArray(jobs.dedupeKey, createdChats.map((id) => `chat.title:${id}`)));
  await db.delete(usageEvents).where(and(eq(usageEvents.feature, "agent_chat"), inArray(sql`${usageEvents.meta}->>'chatId'`, createdChats)));
  await db.delete(chats).where(inArray(chats.id, createdChats));
});

suite("chat orchestrator (stub provider, dev DB)", () => {
  it("persists the turn, streams parts and runs registry tools scoped to the project", async () => {
    const res = await sendChatMessage({ ctx, chatId: null, mode: "send", text: "What do we know about the business?", attachmentIds: [], selection: "api:anthropic" });
    createdChats.push(res.chat.id);
    expect(res.chat.title).toBe("What do we know about the business?");
    expect(res.userMessage?.parts).toEqual([{ type: "text", text: "What do we know about the business?" }]);
    expect(res.assistantMessage.status).toBe("streaming");

    const final = await waitDone(res.assistantMessage.id);
    expect(final.status).toBe("complete");
    expect(final.parts.map((p) => p.type)).toEqual(["thinking", "tool_call", "text"]);
    const tool = final.parts[1] as Extract<ChatMessageView["parts"][number], { type: "tool_call" }>;
    expect(tool.state).toBe("success");
    expect((tool.data as { projectId?: string }).projectId).toBe(PROJECT_ID);
    expect(final.runtime).toMatchObject({ kind: "api", provider: "anthropic", model: "stub-model" });

    // The provider saw the project-specific system prompt and the transcript.
    const turn = seen[seen.length - 1]!;
    expect(turn.system.project).toContain(ctx.project.name);
    expect(turn.system.project).toContain(PROJECT_ID);
    expect(turn.transcript.map((m) => m.role)).toEqual(["user"]);
    expect(turn.tools.some((t) => t.name === "get_visibility_metrics")).toBe(true);
    // User-initiated chat may use paid tools ("spend" scope) when the role allows it (owner: seo.run).
    expect(turn.tools.some((t) => t.name === "research_keywords")).toBe(true);
    expect(turn.tools.some((t) => t.name === "list_projects" || t.name === "create_project")).toBe(false);
    expect(turn.tools.every((t) => !("projectId" in ((t.inputSchema.properties as object) ?? {})))).toBe(true);

    const row = await getMessage(res.assistantMessage.id);
    expect(row?.status).toBe("complete");
    expect(row?.content).toContain("Answer for: What do we know");
    const [u] = await db.select().from(usageEvents).where(eq(usageEvents.feature, "agent_chat")).orderBy(usageEvents.createdAt);
    expect(u).toBeTruthy();
  });

  it("regenerates and edits the last turn, replaying history", async () => {
    const chatId = createdChats[0]!;
    const regen = await sendChatMessage({ ctx, chatId, mode: "regenerate", text: "", attachmentIds: [], selection: "api:anthropic" });
    await waitDone(regen.assistantMessage.id);
    let rows = await listMessageRows(chatId);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[1]!.id).toBe(regen.assistantMessage.id);

    const follow = await sendChatMessage({ ctx, chatId, mode: "send", text: "And the competitors?", attachmentIds: [], selection: "api:anthropic" });
    await waitDone(follow.assistantMessage.id);
    expect(seen[seen.length - 1]!.transcript.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    const edited = await sendChatMessage({ ctx, chatId, mode: "edit", text: "And our goals?", attachmentIds: [], selection: "api:anthropic", targetMessageId: follow.userMessage!.id });
    const done = await waitDone(edited.assistantMessage.id);
    expect(done.parts.some((p) => p.type === "text" && p.text.includes("And our goals?"))).toBe(true);
    rows = await listMessageRows(chatId);
    expect(rows).toHaveLength(4);
    await expect(
      sendChatMessage({ ctx, chatId, mode: "edit", text: "x", attachmentIds: [], selection: "api:anthropic", targetMessageId: rows[0]!.id }),
    ).rejects.toThrow(/latest message/);
  });

  it("stops a running answer and keeps the partial text", async () => {
    behaviour = "hang";
    try {
      const res = await sendChatMessage({ ctx, chatId: null, mode: "send", text: "Long task", attachmentIds: [], selection: "api:anthropic" });
      createdChats.push(res.chat.id);
      await new Promise((r) => setTimeout(r, 150));
      expect(stopRun(res.assistantMessage.id, "someone-else")).toBe(false);
      expect(stopRun(res.assistantMessage.id, ctx.user.id)).toBe(true);
      const final = await waitDone(res.assistantMessage.id);
      expect(final.status).toBe("stopped");
      expect(final.parts).toEqual([{ type: "text", text: "Partial…" }]);
    } finally {
      behaviour = "answer";
    }
  });

  it("refuses read-only users", async () => {
    const readOnly = { ...ctx, permissions: new Set<Permission>(["project.view"]) };
    await expect(sendChatMessage({ ctx: readOnly, chatId: null, mode: "send", text: "hi", attachmentIds: [], selection: "auto" })).rejects.toThrow(/read-only/);
  });
});
