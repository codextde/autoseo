import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { oauthAuthorizationCodes, oauthGrants } from "@/server/db/schema";
import { API_SCOPES, type ApiScope, isApiScope } from "@/features/api-settings/scopes";
import { randomToken } from "@/server/crypto";
import { apiUrls } from "../urls";
import { hashSecret } from "../tokens";
import { getClient, redirectUriMatches, type OAuthClient } from "./clients";
import { normalizeResource } from "./metadata";

export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

export const AUTHORIZE_PARAM_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export function pickAuthorizeParams(input: Record<string, string | string[] | undefined>): AuthorizeParams {
  const out: AuthorizeParams = {};
  for (const k of AUTHORIZE_PARAM_KEYS) {
    const v = input[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.length <= 4096) out[k] = s;
  }
  return out;
}

export type ValidAuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  redirectUriExplicit: boolean;
  scopes: ApiScope[];
  state: string | null;
  codeChallenge: string;
  resource: string | null;
};

export type AuthorizeValidation =
  | { ok: true; request: ValidAuthorizeRequest }
  /** Errors we must NOT redirect for (unknown client / bad redirect URI) — shown on the page. */
  | { ok: false; fatal: true; error: string; description: string }
  /** Errors reported back to the client via its redirect URI. */
  | { ok: false; fatal: false; redirectTo: string };

export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

/** Validates an OAuth 2.1 authorization request (authorization code + PKCE S256 only). */
export async function validateAuthorizeRequest(p: AuthorizeParams): Promise<AuthorizeValidation> {
  const client = await getClient(p.client_id);
  if (!client) {
    return {
      ok: false,
      fatal: true,
      error: "invalid_client",
      description: "Unknown client_id. The application must register with this server first (dynamic client registration).",
    };
  }
  let redirectUri: string | undefined;
  let explicit = false;
  if (p.redirect_uri) {
    const match = client.redirectUris.find((r) => redirectUriMatches(r, p.redirect_uri!));
    if (!match) {
      return {
        ok: false,
        fatal: true,
        error: "invalid_request",
        description: "The redirect_uri does not match any redirect URI registered for this client.",
      };
    }
    redirectUri = p.redirect_uri;
    explicit = true;
  } else if (client.redirectUris.length === 1) {
    redirectUri = client.redirectUris[0];
  } else {
    return { ok: false, fatal: true, error: "invalid_request", description: "redirect_uri is required." };
  }
  const state = p.state ?? null;
  const fail = (error: string, description: string) => ({
    ok: false as const,
    fatal: false as const,
    redirectTo: buildRedirect(redirectUri!, { error, error_description: description, state, iss: apiUrls.issuer }),
  });

  if (p.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (!client.responseTypes.includes("code")) return fail("unauthorized_client", "Client is not registered for the code flow.");
  if (!p.code_challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  if ((p.code_challenge_method ?? "plain") !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge)) return fail("invalid_request", "Malformed code_challenge.");

  let scopes: ApiScope[];
  if (p.scope && p.scope.trim()) {
    const requested = p.scope.split(/[\s,]+/).filter(Boolean);
    // Tolerate common generic scopes sent by MCP clients (e.g. "mcp", "offline_access").
    const known = requested.filter((s) => isApiScope(s));
    const generic = requested.filter((s) => ["mcp", "offline_access", "openid", "profile", "email"].includes(s));
    if (known.length === 0 && generic.length === 0) return fail("invalid_scope", `Unknown scope. Supported: ${API_SCOPES.join(" ")}`);
    scopes = known.length ? (["read", ...known.filter((s): s is ApiScope => s !== "read")] as ApiScope[]) : ["read", "write"];
  } else {
    scopes = ["read", "write"];
  }
  scopes = API_SCOPES.filter((s) => scopes.includes(s));

  const resource = normalizeResource(p.resource);
  if (!resource.ok) return fail("invalid_target", "The requested resource is not served by this authorization server.");

  return {
    ok: true,
    request: {
      client,
      redirectUri: redirectUri!,
      redirectUriExplicit: explicit,
      scopes,
      state,
      codeChallenge: p.code_challenge,
      resource: resource.value,
    },
  };
}

/**
 * Records the user's consent (one active grant per client × user × workspace) and issues a
 * single-use authorization code. Returns the redirect URL for the client.
 */
export async function approveAuthorization(input: {
  request: ValidAuthorizeRequest;
  userId: string;
  workspaceId: string;
  scopes: ApiScope[];
  projectIds: string[] | null;
}): Promise<string> {
  const { request } = input;
  const scopes = API_SCOPES.filter((s) => s === "read" || input.scopes.includes(s));
  const [existing] = await db
    .select()
    .from(oauthGrants)
    .where(
      and(
        eq(oauthGrants.clientId, request.client.id),
        eq(oauthGrants.userId, input.userId),
        eq(oauthGrants.workspaceId, input.workspaceId),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .limit(1);
  let grantId: string;
  if (existing) {
    await db
      .update(oauthGrants)
      .set({ scopes, projectIds: input.projectIds, resource: request.resource, lastUsedAt: new Date() })
      .where(eq(oauthGrants.id, existing.id));
    grantId = existing.id;
  } else {
    const [g] = await db
      .insert(oauthGrants)
      .values({
        clientId: request.client.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        scopes,
        projectIds: input.projectIds,
        resource: request.resource,
      })
      .returning({ id: oauthGrants.id });
    grantId = g!.id;
  }
  const code = `as_code_${randomToken(32)}`;
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hashSecret(code),
    grantId,
    clientId: request.client.id,
    userId: input.userId,
    redirectUri: request.redirectUri,
    redirectUriExplicit: request.redirectUriExplicit ? "yes" : "no",
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: "S256",
    scopes,
    resource: request.resource,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  return buildRedirect(request.redirectUri, { code, state: request.state, iss: apiUrls.issuer });
}

export function denyAuthorization(request: ValidAuthorizeRequest): string {
  return buildRedirect(request.redirectUri, {
    error: "access_denied",
    error_description: "The user denied access.",
    state: request.state,
    iss: apiUrls.issuer,
  });
}
