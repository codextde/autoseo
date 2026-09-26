import "server-only";
import { env } from "@/server/env";

/** Public URLs of the platform API (all derived from the instance base URL). */
export const apiUrls = {
  get base() {
    return env.appUrl;
  },
  get issuer() {
    return env.appUrl;
  },
  get mcp() {
    return `${env.appUrl}/api/mcp`;
  },
  get rest() {
    return `${env.appUrl}/api/v1`;
  },
  get openapi() {
    return `${env.appUrl}/api/v1/openapi.json`;
  },
  get docs() {
    return `${env.appUrl}/settings/api/docs`;
  },
  get authorize() {
    return `${env.appUrl}/oauth/authorize`;
  },
  get token() {
    return `${env.appUrl}/api/oauth/token`;
  },
  get register() {
    return `${env.appUrl}/api/oauth/register`;
  },
  get revoke() {
    return `${env.appUrl}/api/oauth/revoke`;
  },
  /** RFC 9728 metadata URL for a protected resource path (e.g. "/api/mcp"). */
  resourceMetadata(resourcePath: string) {
    return `${env.appUrl}/.well-known/oauth-protected-resource${resourcePath}`;
  },
};

/** `WWW-Authenticate` challenge pointing MCP / API clients at the resource metadata (RFC 9728 §5.1). */
export function bearerChallenge(resourcePath: string, error?: { code: string; description?: string; scope?: string }) {
  const parts = [`Bearer realm="autoseo"`, `resource_metadata="${apiUrls.resourceMetadata(resourcePath)}"`];
  if (error) {
    parts.push(`error="${error.code}"`);
    if (error.description) parts.push(`error_description="${error.description.replace(/"/g, "'")}"`);
    if (error.scope) parts.push(`scope="${error.scope}"`);
  }
  return parts.join(", ");
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, X-Api-Key, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
  "Access-Control-Expose-Headers":
    "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
