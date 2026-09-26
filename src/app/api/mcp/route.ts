import { after, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { authenticateRequest } from "@/server/api/handler";
import { logApiRequest } from "@/server/api/logging";
import { checkRateLimit, rateLimitHeaders } from "@/server/api/rate-limit";
import { getSetting } from "@/server/settings";
import { CORS_HEADERS, corsPreflight } from "@/server/api/urls";
import { getBranding } from "@/server/branding";
import { env } from "@/server/env";
import { handleMcpBody, SUPPORTED_PROTOCOL_VERSIONS } from "@/server/mcp/server";

const MAX_BODY = 1024 * 1024;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", ...CORS_HEADERS, ...headers },
  });
}

/** MCP Streamable HTTP endpoint (stateless, JSON responses). Auth: API key or OAuth access token. */
export async function POST(req: NextRequest) {
  const started = performance.now();
  const auth = await authenticateRequest(req, "/api/mcp");
  if (!auth.ok) {
    return json(auth.status, { jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.message } }, auth.headers);
  }
  const version = req.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version) && version < "2026-01-01") {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${version}` } });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } });

  const requestId = `mcp_${nanoid(16)}`;
  const brand = await getBranding();
  const { apiRateLimitPerMinute } = await getSetting("security");
  const rateKey = `api:${auth.principal.rateKey}`;
  const result = await handleMcpBody(raw, { principal: auth.principal, requestId, baseUrl: env.appUrl }, brand.appName, {
    chargeToolCall: () => checkRateLimit(rateKey, apiRateLimitPerMinute),
  });
  const headers = { ...rateLimitHeaders(auth.rate), "X-Request-Id": requestId };

  // Version-negotiation probes (2026-era `server/discover`, answered with "method not found" so
  // clients fall back to `initialize`) are not usage.
  const calls = result.calls.filter((c) => c.method !== "server/discover");
  if (calls.length) {
    const principal = auth.principal;
    after(async () => {
      const duration = performance.now() - started;
      for (const c of calls) {
        await logApiRequest({
          credentialId: principal.credentialId,
          workspaceId: principal.workspace.id,
          path: c.tool ? `/api/mcp/tools/${c.tool}` : `/api/mcp/${c.method}`,
          method: "MCP",
          status: c.isError ? 400 : 200,
          durationMs: duration / calls.length,
        });
      }
    });
  }
  return json(result.status, result.body, headers);
}

/** No server-initiated SSE stream is offered (stateless server). */
export async function GET() {
  return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed. Use POST." } }, { Allow: "POST, OPTIONS" });
}

/** Sessions are not used, so there is nothing to terminate. */
export async function DELETE() {
  return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Sessions are not supported." } }, { Allow: "POST, OPTIONS" });
}

export async function OPTIONS() {
  return corsPreflight();
}
