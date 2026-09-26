import { describe, expect, it } from "vitest";
import type { ApiPrincipal } from "@/server/api/auth";
import fs from "node:fs";
import path from "node:path";
import { handleMcpBody, LATEST_PROTOCOL_VERSION, MAX_BATCH_MESSAGES, toolDescriptors } from "./server";
import { MCP_TOOLS, SPEND_TOOL_NAMES } from "./tools";
import { SPEND_ROUTES } from "@/server/api/openapi";

const principal = {
  credentialId: "key_test",
  kind: "api",
  name: "test",
  clientId: null,
  user: { id: "usr_test", email: "t@example.com", name: null },
  workspace: { id: "wsp_test", name: "Test", slug: "test" },
  roleKey: "member",
  permissions: new Set(),
  scopes: new Set(["read"]),
  restrictedProjectIds: null,
  allProjectsRole: false,
  rateKey: "key:test",
} as unknown as ApiPrincipal;
const ctx = { principal, requestId: "t", baseUrl: "http://localhost:3000" };
const rpc = (body: unknown) => handleMcpBody(JSON.stringify(body), ctx, "AutoSEO");

describe("MCP protocol", () => {
  it("negotiates the protocol version on initialize", async () => {
    const known = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect((known.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-03-26");
    const unknown = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    const r = (unknown.body as { result: { protocolVersion: string; capabilities: unknown } }).result;
    expect(r.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(r.capabilities).toEqual({ tools: { listChanged: false } });
  });
  it("answers notifications with 202 and no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });
  it("returns JSON-RPC errors for unknown methods, parse errors and unknown tools", async () => {
    const m = await rpc({ jsonrpc: "2.0", id: 3, method: "server/discover" });
    expect((m.body as { error: { code: number } }).error.code).toBe(-32601);
    const p = await handleMcpBody("{not json", ctx, "AutoSEO");
    expect((p.body as { error: { code: number } }).error.code).toBe(-32700);
    const t = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } });
    expect((t.body as { error: { code: number } }).error.code).toBe(-32602);
  });
  it("supports batches and ping", async () => {
    const res = await rpc([
      { jsonrpc: "2.0", id: 5, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(res.body).toEqual([{ jsonrpc: "2.0", id: 5, result: {} }]);
  });
  it("hides write tools from read-only credentials and refuses them as tool errors", async () => {
    const readOnly = toolDescriptors(new Set(["read"])).map((t) => t.name);
    expect(readOnly).toContain("get_visibility_metrics");
    expect(readOnly).not.toContain("add_prompts");
    const res = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "add_prompts", arguments: { prompts: ["x"] } } });
    const r = (res.body as { result: { isError: boolean; content: { text: string }[] } }).result;
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/write/);
  });
  it("publishes object input schemas for every tool", () => {
    for (const t of toolDescriptors(new Set(["read", "write", "spend", "export"]))) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("requires the spend scope for every cost-incurring tool", async () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const n of SPEND_TOOL_NAMES) expect(names.has(n), n).toBe(true);
    const withoutSpend = toolDescriptors(new Set(["read", "write", "export"])).map((t) => t.name);
    for (const n of SPEND_TOOL_NAMES) expect(withoutSpend).not.toContain(n);
    const res = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "research_keywords", arguments: {} } });
    const r = (res.body as { result: { isError: boolean; content: { text: string }[] } }).result;
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/spend/);
  });
  it("charges the rate limiter for every extra tool call in a batch and caps batch size", async () => {
    let charged = 0;
    const batch = [1, 2, 3].map((id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "nope", arguments: {} } }));
    await handleMcpBody(JSON.stringify(batch), ctx, "AutoSEO", {
      chargeToolCall: () => {
        charged++;
        return { allowed: charged < 2, retryAfter: 5 };
      },
    });
    expect(charged).toBe(2);
    const limited = await handleMcpBody(JSON.stringify(batch), ctx, "AutoSEO", { chargeToolCall: () => ({ allowed: false, retryAfter: 9 }) });
    const errs = (limited.body as { error?: { code: number } }[]).map((r) => r.error?.code);
    expect(errs.slice(1)).toEqual([-32029, -32029]);
    const tooBig = await handleMcpBody(JSON.stringify(Array.from({ length: MAX_BATCH_MESSAGES + 1 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }))), ctx, "AutoSEO");
    expect(tooBig.status).toBe(400);
  });
  it("marks exactly the documented cost-incurring REST routes with spend: true", () => {
    const root = path.resolve(__dirname, "../../app/api/v1");
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") {
          const src = fs.readFileSync(p, "utf8");
          const rel = "/" + path.relative(root, path.dirname(p)).split(path.sep).map((seg) => seg.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
          for (const m of src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = apiRoute(?:<[^>]*>)?\(\{([^}]*)\}/g)) {
            if (/spend:\s*true/.test(m[2]!)) found.add(`${m[1]} ${rel === "/" ? "" : rel}`);
          }
        }
      }
    };
    walk(root);
    expect([...found].sort()).toEqual([...SPEND_ROUTES].sort());
  });
});
