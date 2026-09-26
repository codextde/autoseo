import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { zodIssues } from "@/server/api/errors";
import { toApiError } from "@/server/api/error-map";
import { MCP_TOOLS, MCP_TOOL_GROUPS, getTool } from "./tools";
import type { McpTool, McpToolContext } from "./types";

/**
 * Minimal, stateless MCP server (Streamable HTTP, JSON responses only — no SSE, no sessions).
 * Implements the 2024-11-05 … 2025-11-25 protocol revisions: initialize, ping, tools/list,
 * tools/call and notifications. Every HTTP request is authenticated independently.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]!;

const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type Id = string | number | null;
type JsonRpcMessage = { jsonrpc?: string; id?: Id; method?: string; params?: unknown; result?: unknown; error?: unknown };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const INSTRUCTIONS = [
  "AutoSEO provides AI visibility (GEO) data: how AI engines (ChatGPT, Perplexity, Google AI Overviews, Gemini, Claude, Copilot, …) answer tracked prompts about a brand.",
  "Start with list_projects to get a projectId (optional when only one project is accessible).",
  "Call get_project_context first to learn the business, goals and prior research; write durable findings back with update_project_context.",
  "Most tools accept timeframeDays (default 30) or startDate/endDate, model (AI engine id) and tags filters.",
  "Percentages are 0–100, sentiment is 0–100, avgPosition 1 = named first.",
  "Tools that can incur cost (DataForSEO research, AI generation, tracking runs) are only listed when the connection has the spend scope; prefer cached/free tools and confirm large paid batches with the user.",
].join(" ");

let schemaCache: Map<string, Record<string, unknown>> | null = null;

function inputJsonSchema(tool: McpTool): Record<string, unknown> {
  schemaCache ??= new Map();
  let s = schemaCache.get(tool.name);
  if (!s) {
    const raw = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete raw.$schema;
    if (raw.type !== "object") raw.type = "object";
    raw.properties ??= {};
    s = raw;
    schemaCache.set(tool.name, s);
  }
  return s;
}

function toolDescriptor(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputJsonSchema(tool),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.annotations?.readOnlyHint ?? tool.scope === "read",
      destructiveHint: tool.annotations?.destructiveHint ?? false,
      idempotentHint: tool.annotations?.idempotentHint ?? tool.scope === "read",
      openWorldHint: tool.annotations?.openWorldHint ?? false,
    },
  };
}

function visibleFor(t: McpTool, scopes: ReadonlySet<string>) {
  return scopes.has(t.scope) && (!t.spend || scopes.has("spend"));
}

/** Tool descriptors (`tools/list`) visible to a credential with the given scopes. */
export function toolDescriptors(scopes: ReadonlySet<string>) {
  return MCP_TOOLS.filter((t) => visibleFor(t, scopes)).map(toolDescriptor);
}

/** Tools grouped by domain with their required scope / permission (settings + docs pages). */
export function toolCatalog() {
  return MCP_TOOL_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    tools: g.tools.map((t) => ({ ...toolDescriptor(t), scope: t.scope, permission: t.permission ?? null, spend: Boolean(t.spend) })),
  }));
}

const MAX_TEXT = 60_000;

function toolResult(text: string, data: Record<string, unknown>, isError = false) {
  const json = JSON.stringify(data);
  const body =
    json.length + text.length < MAX_TEXT
      ? `${text}\n\n---\nJSON:\n${json}`
      : `${text}\n\n_(Full structured data is in structuredContent; it is too large to repeat here.)_`;
  return { content: [{ type: "text", text: body.slice(0, MAX_TEXT) }], structuredContent: data, isError };
}

function toolError(message: string, details?: unknown) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    structuredContent: { ok: false, error: { message, ...(details ? { details } : {}) } },
    isError: true,
  };
}

export type CallInfo = { method: string; tool?: string; isError?: boolean };

async function callTool(params: unknown, ctx: McpToolContext, info: CallInfo) {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== "string") throw new RpcError(JSONRPC.INVALID_PARAMS, "params.name is required");
  const tool = getTool(p.name);
  info.tool = p.name;
  if (!tool) throw new RpcError(JSONRPC.INVALID_PARAMS, `Unknown tool: ${p.name}`);
  if (!ctx.principal.scopes.has(tool.scope)) {
    info.isError = true;
    return toolError(`This connection lacks the "${tool.scope}" scope required by ${tool.name}. Reconnect with more permissions or use another API key.`);
  }
  if (tool.spend && !ctx.principal.scopes.has("spend")) {
    info.isError = true;
    return toolError(
      `${tool.name} can incur cost (paid data / AI), which requires the "spend" scope. Create an API key with "Spend credits" or reconnect and allow it.`,
    );
  }
  if (tool.permission && !ctx.principal.permissions.has(tool.permission)) {
    info.isError = true;
    return toolError(`Your role in this workspace does not allow ${tool.name} (${tool.permission}).`);
  }
  const parsed = tool.input.safeParse(p.arguments ?? {});
  if (!parsed.success) {
    info.isError = true;
    const issues = zodIssues(parsed.error) ?? [];
    return toolError(`Invalid arguments: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, issues);
  }
  try {
    const res = await tool.handler(parsed.data, ctx);
    info.isError = Boolean(res.isError);
    return toolResult(res.text, res.data, res.isError);
  } catch (err) {
    info.isError = true;
    const apiErr = toApiError(err);
    if (apiErr) return toolError(apiErr.message, { code: apiErr.code, ...(apiErr.details && typeof apiErr.details === "object" ? apiErr.details : {}) });
    const issues = zodIssues(err);
    if (issues) return toolError(`Invalid input: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, issues);
    console.error(`[mcp] tool ${tool.name} failed`, err);
    return toolError("The tool failed unexpectedly. Please try again later.");
  }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

async function dispatch(msg: JsonRpcMessage, ctx: McpToolContext, info: CallInfo, appName: string): Promise<unknown> {
  const method = msg.method!;
  switch (method) {
    case "initialize": {
      const requested = (msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "autoseo",
          title: `${appName} MCP`,
          version: env.buildCommit === "dev" ? "0.1.0-dev" : `0.1.0+${env.buildCommit.slice(0, 7)}`,
          websiteUrl: env.appUrl,
        },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolDescriptors(ctx.principal.scopes) };
    case "tools/call":
      return callTool(msg.params, ctx, info);
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new RpcError(JSONRPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

export type McpHandled = {
  /** null = nothing to return (only notifications / responses) → HTTP 202. */
  body: JsonRpcResponse | JsonRpcResponse[] | null;
  calls: CallInfo[];
  status: number;
};

export const MAX_BATCH_MESSAGES = 20;

/**
 * Handles one HTTP POST body (single message or batch). `chargeToolCall` is invoked for every
 * `tools/call` after the first one in the body (the HTTP request itself was already charged), so a
 * JSON-RPC batch cannot bypass the per-credential rate limit.
 */
export async function handleMcpBody(
  raw: string,
  ctx: McpToolContext,
  appName: string,
  opts: { chargeToolCall?: () => { allowed: boolean; retryAfter: number } } = {},
): Promise<McpHandled> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { body: { jsonrpc: "2.0", id: null, error: { code: JSONRPC.PARSE_ERROR, message: "Parse error" } }, calls: [], status: 400 };
  }
  const batch = Array.isArray(payload);
  const messages = (batch ? payload : [payload]) as JsonRpcMessage[];
  if (!messages.length) {
    return { body: { jsonrpc: "2.0", id: null, error: { code: JSONRPC.INVALID_REQUEST, message: "Empty batch" } }, calls: [], status: 400 };
  }
  const calls: CallInfo[] = [];
  const responses: JsonRpcResponse[] = [];
  if (messages.length > MAX_BATCH_MESSAGES) {
    return {
      body: { jsonrpc: "2.0", id: null, error: { code: JSONRPC.INVALID_REQUEST, message: `Batch too large (max ${MAX_BATCH_MESSAGES} messages).` } },
      calls: [],
      status: 400,
    };
  }
  let toolCalls = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || (msg.jsonrpc !== undefined && msg.jsonrpc !== "2.0")) {
      responses.push({ jsonrpc: "2.0", id: null, error: { code: JSONRPC.INVALID_REQUEST, message: "Invalid Request" } });
      continue;
    }
    // Responses from the client (to server-initiated requests) — we never send any; ignore.
    if (msg.method === undefined && ("result" in msg || "error" in msg)) continue;
    if (typeof msg.method !== "string") {
      responses.push({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: JSONRPC.INVALID_REQUEST, message: "Invalid Request" } });
      continue;
    }
    const isNotification = msg.id === undefined || msg.id === null;
    if (isNotification) continue; // notifications/initialized, notifications/cancelled, …
    const info: CallInfo = { method: msg.method };
    calls.push(info);
    if (msg.method === "tools/call" && toolCalls++ > 0 && opts.chargeToolCall) {
      const charge = opts.chargeToolCall();
      if (!charge.allowed) {
        info.isError = true;
        responses.push({
          jsonrpc: "2.0",
          id: msg.id!,
          error: { code: -32029, message: `Rate limit exceeded — retry after ${charge.retryAfter}s.`, data: { retryAfter: charge.retryAfter } },
        });
        continue;
      }
    }
    try {
      const result = await dispatch(msg, ctx, info, appName);
      responses.push({ jsonrpc: "2.0", id: msg.id!, result });
    } catch (err) {
      info.isError = true;
      if (err instanceof RpcError) {
        responses.push({ jsonrpc: "2.0", id: msg.id!, error: { code: err.code, message: err.message, data: err.data } });
      } else {
        console.error("[mcp] request failed", err);
        responses.push({ jsonrpc: "2.0", id: msg.id!, error: { code: JSONRPC.INTERNAL_ERROR, message: "Internal error" } });
      }
    }
  }
  if (!responses.length) return { body: null, calls, status: 202 };
  return { body: batch ? responses : responses[0]!, calls, status: 200 };
}
