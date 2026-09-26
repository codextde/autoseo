import { handleFreeToolRequest } from "@/server/free-tools/public";

export const dynamic = "force-dynamic";

/**
 * Public free SEO tool API (no login). Only answers when Admin → Free SEO tools → "Public" is enabled; every request
 * runs the open-seo protection pipeline (see `handleFreeToolRequest`).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/free-tools/[tool]">) {
  const { tool } = await ctx.params;
  return handleFreeToolRequest(req, tool);
}
