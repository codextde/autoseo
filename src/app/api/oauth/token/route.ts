import { authenticateClient } from "@/server/api/oauth/clients";
import { exchangeAuthorizationCode, exchangeRefreshToken, OAuthTokenError } from "@/server/api/oauth/token";
import { readFormOrJson } from "@/server/api/oauth/body";
import { checkRateLimit, clientIp } from "@/server/api/rate-limit";
import { CORS_HEADERS } from "@/server/api/urls";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...CORS_HEADERS };

function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error, error_description: description }), { status, headers: { ...HEADERS, ...extra } });
}

/** OAuth 2.1 token endpoint: authorization_code (+PKCE) and refresh_token grants. */
export async function POST(req: Request) {
  const rl = checkRateLimit(`oauth-token:${clientIp(req.headers)}`, 120);
  if (!rl.allowed) return oauthError("invalid_request", "Too many requests.", 429, { "Retry-After": String(rl.retryAfter) });
  const body = await readFormOrJson(req);
  if (!body) return oauthError("invalid_request", "Unsupported or malformed request body.");

  const client = await authenticateClient(req, body);
  if (!client) {
    return oauthError("invalid_client", "Client authentication failed.", 401, { "WWW-Authenticate": 'Basic realm="autoseo"' });
  }
  const grantType = body.get("grant_type");
  if (!grantType || !client.grantTypes.includes(grantType)) {
    return oauthError(grantType ? "unauthorized_client" : "invalid_request", grantType ? "Grant type not allowed for this client." : "grant_type is required.");
  }
  try {
    const tokens =
      grantType === "authorization_code"
        ? await exchangeAuthorizationCode(client, body)
        : grantType === "refresh_token"
          ? await exchangeRefreshToken(client, body)
          : null;
    if (!tokens) return oauthError("unsupported_grant_type", "Supported: authorization_code, refresh_token.");
    return new Response(JSON.stringify(tokens), { status: 200, headers: HEADERS });
  } catch (err) {
    if (err instanceof OAuthTokenError) return oauthError(err.error, err.description, err.status);
    console.error("[oauth] token error", err);
    return oauthError("server_error", "Token request failed.", 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
