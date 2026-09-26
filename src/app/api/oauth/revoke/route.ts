import { authenticateClient } from "@/server/api/oauth/clients";
import { revokeToken } from "@/server/api/oauth/token";
import { readFormOrJson } from "@/server/api/oauth/body";
import { checkRateLimit, clientIp } from "@/server/api/rate-limit";
import { CORS_HEADERS } from "@/server/api/urls";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS };

/** RFC 7009 token revocation. Unknown tokens are acknowledged with 200 as the RFC requires. */
export async function POST(req: Request) {
  const rl = checkRateLimit(`oauth-revoke:${clientIp(req.headers)}`, 120);
  if (!rl.allowed) return new Response(JSON.stringify({ error: "invalid_request" }), { status: 429, headers: HEADERS });
  const body = await readFormOrJson(req);
  const token = body?.get("token");
  if (!body || !token) {
    return new Response(JSON.stringify({ error: "invalid_request", error_description: "token is required." }), { status: 400, headers: HEADERS });
  }
  const client = await authenticateClient(req, body);
  if (!client) {
    return new Response(JSON.stringify({ error: "invalid_client", error_description: "Client authentication failed." }), {
      status: 401,
      headers: HEADERS,
    });
  }
  await revokeToken(client, token);
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
