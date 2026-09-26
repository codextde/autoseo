import { claudeUrlMarketplace } from "@/server/api/plugin";
import { PUBLIC_DOWNLOAD_HEADERS, pluginInstance } from "@/server/api/plugin-http";

/**
 * GET /api/plugin/marketplace.json — Claude Code URL marketplace for this instance:
 * `claude plugin marketplace add <app>/api/plugin/marketplace.json`. The plugin is served as an
 * HTTPS archive pinned by SHA-256. Public: it contains no secrets (sign-in happens via OAuth).
 */
export async function GET() {
  const body = claudeUrlMarketplace(await pluginInstance());
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { ...PUBLIC_DOWNLOAD_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
