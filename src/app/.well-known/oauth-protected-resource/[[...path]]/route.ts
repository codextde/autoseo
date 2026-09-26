import { METADATA_HEADERS, protectedResourceMetadata } from "@/server/api/oauth/metadata";

/**
 * RFC 9728 protected resource metadata. `/.well-known/oauth-protected-resource/api/mcp` describes
 * the MCP server, `/…/api/v1` the REST API; the bare URL defaults to the MCP server.
 */
export async function GET(_req: Request, ctx: RouteContext<"/.well-known/oauth-protected-resource/[[...path]]">) {
  const { path } = await ctx.params;
  const resourcePath = path?.length ? `/${path.join("/")}` : "/api/mcp";
  return new Response(JSON.stringify(protectedResourceMetadata(resourcePath)), { headers: METADATA_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_HEADERS });
}
