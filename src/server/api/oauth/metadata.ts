import "server-only";
import { API_SCOPES } from "@/features/api-settings/scopes";
import { apiUrls } from "../urls";

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata() {
  return {
    issuer: apiUrls.issuer,
    authorization_endpoint: apiUrls.authorize,
    token_endpoint: apiUrls.token,
    registration_endpoint: apiUrls.register,
    revocation_endpoint: apiUrls.revoke,
    scopes_supported: [...API_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
    service_documentation: apiUrls.docs,
  };
}

/** Resources protected by this server (path → display name). */
export const PROTECTED_RESOURCES: Record<string, string> = {
  "/api/mcp": "AutoSEO MCP",
  "/api/v1": "AutoSEO REST API",
};

/** RFC 9728 protected resource metadata. */
export function protectedResourceMetadata(resourcePath: string) {
  const path = PROTECTED_RESOURCES[resourcePath] ? resourcePath : "/api/mcp";
  return {
    resource: `${apiUrls.base}${path}`,
    authorization_servers: [apiUrls.issuer],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: PROTECTED_RESOURCES[path],
    resource_documentation: apiUrls.docs,
  };
}

/** Resource indicators (RFC 8707) we accept — compared by path so proxies/hostnames don't matter. */
export function normalizeResource(resource: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (!resource) return { ok: true, value: null };
  try {
    const u = new URL(resource);
    if (u.hash) return { ok: false };
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || PROTECTED_RESOURCES[path]) return { ok: true, value: `${u.origin}${path === "/" ? "" : path}` };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export const METADATA_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};
