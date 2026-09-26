import { env } from "@/server/env";
import { BOT_UA_PATTERN } from "@/server/analytics/bots/bot-classifier";

export const dynamic = "force-dynamic";

/**
 * Public Cloudflare Worker script that reports AI-crawler requests to the NDJSON ingest endpoint.
 * Contains no secrets: the ingest token is read from the Worker secret `AUTOSEO_TOKEN`.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/public/cloudflare-worker/[projectId]">) {
  const { projectId } = await ctx.params;
  if (!/^prj_[a-z0-9]{6,32}$/.test(projectId)) return new Response("// Invalid project id\n", { status: 400, headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  const endpoint = `${env.appUrl}/api/webhooks/server-logs`;
  const script = `// AutoSEO — AI crawler logging Worker (project ${projectId})
// Generated ${new Date().toISOString().slice(0, 10)}. Deploy with Wrangler or paste into the Cloudflare dashboard.
//
// 1. wrangler secret put AUTOSEO_TOKEN     (paste the fslg_… token from AutoSEO → Bot Traffic → Sync → Cloudflare)
// 2. Add a route for your zone, e.g. example.com/*  (Workers Routes), so the Worker sees every request.
//
// The Worker never changes responses: it forwards each request to your origin and, only for known
// AI / search crawler user agents, sends one NDJSON line in the background (ctx.waitUntil).

const ENDPOINT = ${JSON.stringify(endpoint)};
const BOT_RE = new RegExp(${JSON.stringify(BOT_UA_PATTERN)}, "i");

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    try {
      const ua = request.headers.get("user-agent") || "";
      if (env.AUTOSEO_TOKEN && BOT_RE.test(ua)) {
        const url = new URL(request.url);
        const line = JSON.stringify({
          timestamp: new Date().toISOString(),
          ip: request.headers.get("cf-connecting-ip") || "",
          method: request.method,
          host: url.host,
          path: url.pathname + url.search,
          status: response.status,
          user_agent: ua,
          bytes: Number(response.headers.get("content-length")) || null,
        });
        ctx.waitUntil(
          fetch(ENDPOINT, {
            method: "POST",
            headers: { authorization: "Bearer " + env.AUTOSEO_TOKEN, "content-type": "application/x-ndjson" },
            body: line + "\\n",
          }).catch(() => {}),
        );
      }
    } catch (_) {
      // Logging must never break the site.
    }
    return response;
  },
};
`;
  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Disposition": `inline; filename="autoseo-bot-logger.js"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
