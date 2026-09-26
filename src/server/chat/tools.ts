import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import { MCP_TOOLS, getTool } from "@/server/mcp/tools";
import type { McpTool, McpToolContext } from "@/server/mcp/types";
import type { ApiPrincipal } from "@/server/api/auth";
import { toApiError } from "@/server/api/error-map";
import { zodIssues } from "@/server/api/errors";
import type { ApiScope } from "@/features/api-settings/scopes";
import type { Permission } from "@/server/auth/permissions";
import { env } from "@/server/env";

/**
 * Adapter between the chat orchestrator (API fallback path) and the MCP tool registry: tools run
 * in-process with the chatting user's current permissions, pinned to the active project.
 */

/** Tools that make no sense inside a project-scoped chat. */
const EXCLUDED_TOOLS = new Set(["list_projects", "create_project"]);

export type ChatActor = {
  user: { id: string; email: string; name: string | null };
  workspace: { id: string; name: string; slug: string };
  roleKey: string;
  permissions: Set<Permission>;
  allProjects: boolean;
  projectId: string;
};

/**
 * Principal equivalent to a project-restricted API key of the user (re-uses all MCP checks). The
 * chat is user-initiated, so it may use cost-incurring tools ("spend") — role permissions such as
 * `seo.run` still decide which ones.
 */
export function chatPrincipal(actor: ChatActor): ApiPrincipal {
  const scopes = new Set<ApiScope>(["read", "export", "spend"]);
  if (actor.permissions.has("prompts.manage")) scopes.add("write");
  return {
    credentialId: `chat:${actor.user.id}`,
    kind: "api",
    name: "Agent chat",
    clientId: null,
    user: actor.user,
    workspace: actor.workspace,
    roleKey: actor.roleKey,
    permissions: actor.permissions,
    scopes,
    restrictedProjectIds: [actor.projectId],
    allProjectsRole: actor.allProjects || actor.permissions.has("projects.all"),
    rateKey: `chat:${actor.user.id}`,
  };
}

export type ChatToolSpec = {
  name: string;
  title: string;
  description: string;
  /** JSON schema of the arguments as the model sees them (projectId removed — injected server-side). */
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

const schemaCache = new Map<string, Record<string, unknown>>();

function hasProjectId(tool: McpTool): boolean {
  return "projectId" in tool.input.shape;
}

function modelSchema(tool: McpTool): Record<string, unknown> {
  let s = schemaCache.get(tool.name);
  if (!s) {
    const obj = hasProjectId(tool) ? tool.input.omit({ projectId: true } as never) : tool.input;
    const raw = z.toJSONSchema(obj as z.ZodObject, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete raw.$schema;
    raw.type = "object";
    raw.properties ??= {};
    s = raw;
    schemaCache.set(tool.name, s);
  }
  return s;
}

/** Tools the user may call in this chat (scope + role permission), in a stable order. */
export function chatToolSpecs(principal: ApiPrincipal): ChatToolSpec[] {
  return MCP_TOOLS.filter(
    (t) =>
      !EXCLUDED_TOOLS.has(t.name) &&
      principal.scopes.has(t.scope) &&
      (!t.spend || principal.scopes.has("spend")) &&
      (!t.permission || principal.permissions.has(t.permission)),
  ).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: modelSchema(t),
    readOnly: t.annotations?.readOnlyHint ?? t.scope === "read",
  }));
}

/** Tools hidden from this user because their role lacks a permission (explained in the system prompt). */
export function lockedTools(principal: ApiPrincipal): { name: string; permission: string }[] {
  return MCP_TOOLS.filter((t) => !EXCLUDED_TOOLS.has(t.name) && t.permission && !principal.permissions.has(t.permission)).map((t) => ({
    name: t.name,
    permission: t.permission!,
  }));
}

export function toolTitle(name: string): string | undefined {
  return getTool(name)?.title;
}

export type ChatToolOutcome = {
  /** Text returned to the model (markdown + JSON payload, capped). */
  modelText: string;
  /** Markdown summary for the UI. */
  output: string;
  data: Record<string, unknown> | null;
  isError: boolean;
};

const MAX_MODEL_TEXT = 40_000;
const MAX_UI_TEXT = 20_000;
const MAX_UI_DATA = 60_000;

function capData(data: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const json = JSON.stringify(data);
    if (json.length <= MAX_UI_DATA) return data;
    return { truncated: true, note: "Structured result too large to store in the chat." };
  } catch {
    return null;
  }
}

function errorOutcome(message: string): ChatToolOutcome {
  return { modelText: `Error: ${message}`, output: message, data: null, isError: true };
}

/**
 * Runs one registry tool for the chat: validates the arguments against the tool's zod schema
 * (projectId injected), enforces scope + role permission, maps known errors to tool errors.
 */
export async function executeChatTool(principal: ApiPrincipal, projectId: string, name: string, rawArgs: unknown): Promise<ChatToolOutcome> {
  const tool = getTool(name);
  if (!tool || EXCLUDED_TOOLS.has(name)) return errorOutcome(`Unknown tool: ${name}`);
  if (!principal.scopes.has(tool.scope)) return errorOutcome(`This chat cannot use ${name} (requires the "${tool.scope}" scope).`);
  if (tool.spend && !principal.scopes.has("spend")) return errorOutcome(`This chat cannot use ${name} (it incurs cost).`);
  if (tool.permission && !principal.permissions.has(tool.permission)) {
    return errorOutcome(`Your role does not allow ${name} (${tool.permission}).`);
  }
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? { ...(rawArgs as Record<string, unknown>) } : {};
  if (hasProjectId(tool)) args.projectId = projectId;
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error) ?? [];
    return errorOutcome(`Invalid arguments: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  const ctx: McpToolContext = { principal, requestId: `chat_${nanoid(12)}`, baseUrl: env.appUrl };
  try {
    const res = await tool.handler(parsed.data, ctx);
    const json = JSON.stringify(res.data ?? {});
    const modelText =
      res.text.length + json.length < MAX_MODEL_TEXT
        ? `${res.text}\n\n---\nJSON:\n${json}`
        : `${res.text.slice(0, MAX_MODEL_TEXT)}\n\n_(Structured data omitted — too large.)_`;
    return { modelText, output: res.text.slice(0, MAX_UI_TEXT), data: capData(res.data ?? {}), isError: Boolean(res.isError) };
  } catch (err) {
    const apiErr = toApiError(err);
    if (apiErr) return errorOutcome(apiErr.message);
    const issues = zodIssues(err);
    if (issues) return errorOutcome(`Invalid input: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    console.error(`[chat] tool ${name} failed`, err);
    return errorOutcome("The tool failed unexpectedly. Please try again later.");
  }
}
