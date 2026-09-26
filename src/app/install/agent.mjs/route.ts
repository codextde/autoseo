import { getAgentRuntime } from "@/server/agents/runtime";

export const dynamic = "force-dynamic";

/** The agent runtime (single dependency-free Node.js file). Verified by SHA-256 before use. */
export async function GET() {
  const rt = getAgentRuntime();
  return new Response(new Uint8Array(rt.content), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": String(rt.size),
      "Cache-Control": "no-store",
      "X-Agent-Version": rt.version,
      "X-Agent-Sha256": rt.sha256,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
