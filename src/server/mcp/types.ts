import "server-only";
import type { z } from "zod";
import type { Permission } from "@/server/auth/permissions";
import type { ApiScope } from "@/features/api-settings/scopes";
import type { ApiPrincipal } from "@/server/api/auth";

export type McpToolContext = {
  principal: ApiPrincipal;
  requestId: string;
  /** Public base URL of the app (for deep links). */
  baseUrl: string;
};

export type McpToolResult = {
  /** Human/agent-readable summary (markdown). The JSON payload is appended automatically. */
  text: string;
  /** Structured payload (returned as `structuredContent`). */
  data: Record<string, unknown>;
  /** Mark as a soft error (tool ran but could not do what was asked). */
  isError?: boolean;
};

export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpTool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Credential scope required to see and call the tool. */
  scope: ApiScope;
  /** Role permission of the credential owner required to call the tool (writes). */
  permission?: Permission;
  /** Can incur cost (DataForSEO, AI generation, tracking runs) → also requires the "spend" scope. Set in tools/index.ts. */
  spend?: boolean;
  annotations?: McpToolAnnotations;
  handler: (args: z.infer<S>, ctx: McpToolContext) => Promise<McpToolResult>;
};

/** Declares a tool. Tools live in `src/server/mcp/tools/<domain>.ts` and are listed in `tools/index.ts`. */
export function defineTool<S extends z.ZodObject>(tool: McpTool<S>): McpTool<S> {
  return tool;
}
