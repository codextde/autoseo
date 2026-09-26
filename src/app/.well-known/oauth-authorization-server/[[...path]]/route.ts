import { authorizationServerMetadata, METADATA_HEADERS } from "@/server/api/oauth/metadata";

/** RFC 8414 authorization server metadata (also answers path-suffixed discovery URLs). */
export async function GET() {
  return new Response(JSON.stringify(authorizationServerMetadata()), { headers: METADATA_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_HEADERS });
}
