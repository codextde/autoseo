import "server-only";
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  apiKeys,
  oauthAuthorizationCodes,
  oauthClients,
  oauthGrants,
  oauthRefreshTokens,
  users,
  workspaceMembers,
} from "@/server/db/schema";
import { OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_REFRESH_TOKEN_PREFIX, type ApiScope, parseScopes } from "@/features/api-settings/scopes";
import { generateSecret, hashSecret } from "../tokens";
import { API_CREDENTIALS_PERMISSION, memberHasPermission } from "../auth";
import { revokeGrantTokens } from "../keys";
import { redirectUriMatches, type OAuthClient } from "./clients";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, rolling

export class OAuthTokenError extends Error {
  constructor(
    public error: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type" | "invalid_scope" | "unauthorized_client",
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type Grant = typeof oauthGrants.$inferSelect;

async function assertGrantUsable(grant: Grant) {
  if (grant.revokedAt) throw new OAuthTokenError("invalid_grant", "The authorization was revoked.");
  const [member] = await db
    .select({ userId: workspaceMembers.userId, status: users.status })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, grant.workspaceId), eq(workspaceMembers.userId, grant.userId)))
    .limit(1);
  if (!member || member.status !== "active") throw new OAuthTokenError("invalid_grant", "The user no longer has access to this workspace.");
  if (!(await memberHasPermission(grant.workspaceId, grant.userId, API_CREDENTIALS_PERMISSION))) {
    throw new OAuthTokenError("invalid_grant", "The user is no longer allowed to connect apps in this workspace.");
  }
}

async function issueTokens(client: OAuthClient, grant: Grant, scopes: ApiScope[]): Promise<TokenResponse> {
  const access = generateSecret(OAUTH_ACCESS_TOKEN_PREFIX);
  await db.insert(apiKeys).values({
    workspaceId: grant.workspaceId,
    userId: grant.userId,
    name: client.name,
    prefix: access.displayPrefix,
    keyHash: access.hash,
    scopes,
    projectIds: grant.projectIds ?? null,
    kind: "oauth",
    oauthClientId: client.id,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
  });
  const response: TokenResponse = {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes.join(" "),
  };
  if (client.grantTypes.includes("refresh_token")) {
    const refresh = generateSecret(OAUTH_REFRESH_TOKEN_PREFIX);
    await db.insert(oauthRefreshTokens).values({
      tokenHash: refresh.hash,
      grantId: grant.id,
      clientId: client.id,
      userId: grant.userId,
      scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    response.refresh_token = refresh.token;
  }
  const now = new Date();
  await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, grant.id));
  await db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, client.id));
  return response;
}

function s256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** grant_type=authorization_code (PKCE S256 required, codes are single use). */
export async function exchangeAuthorizationCode(client: OAuthClient, body: URLSearchParams): Promise<TokenResponse> {
  const code = body.get("code");
  const verifier = body.get("code_verifier");
  const redirectUri = body.get("redirect_uri");
  if (!code) throw new OAuthTokenError("invalid_request", "code is required.");
  if (!verifier) throw new OAuthTokenError("invalid_request", "code_verifier is required (PKCE).");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthTokenError("invalid_request", "Malformed code_verifier.");

  const codeHash = hashSecret(code);
  const [row] = await db.select().from(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.codeHash, codeHash)).limit(1);
  if (!row) throw new OAuthTokenError("invalid_grant", "Invalid authorization code.");

  // Bind the code to this client before anything else, so a leaked code cannot be burned (or
  // trigger replay revocation) by another client.
  if (row.clientId !== client.id) throw new OAuthTokenError("invalid_grant", "Authorization code was issued to another client.");
  if (row.usedAt) {
    // Code replay by the same client: revoke everything issued under this grant (OAuth 2.1 §4.1.3).
    const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).limit(1);
    if (grant) await revokeGrantTokens(grant);
    throw new OAuthTokenError("invalid_grant", "Authorization code was already used.");
  }
  if (row.expiresAt.getTime() < Date.now()) throw new OAuthTokenError("invalid_grant", "Authorization code expired.");
  if (row.redirectUriExplicit === "yes" || redirectUri) {
    if (!redirectUri || !redirectUriMatches(row.redirectUri, redirectUri)) {
      throw new OAuthTokenError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
  }
  if (s256(verifier) !== row.codeChallenge) throw new OAuthTokenError("invalid_grant", "PKCE verification failed.");

  // All checks passed — atomically mark the code as used (single use).
  const [claimed] = await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthAuthorizationCodes.id, row.id), isNull(oauthAuthorizationCodes.usedAt)))
    .returning();
  if (!claimed) throw new OAuthTokenError("invalid_grant", "Authorization code was already used.");

  const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, claimed.grantId)).limit(1);
  if (!grant) throw new OAuthTokenError("invalid_grant", "Authorization not found.");
  await assertGrantUsable(grant);
  return issueTokens(client, grant, claimed.scopes);
}

/** grant_type=refresh_token with rotation; reuse of a rotated token revokes the whole grant. */
export async function exchangeRefreshToken(client: OAuthClient, body: URLSearchParams): Promise<TokenResponse> {
  const token = body.get("refresh_token");
  if (!token) throw new OAuthTokenError("invalid_request", "refresh_token is required.");
  const [row] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, hashSecret(token))).limit(1);
  if (!row) throw new OAuthTokenError("invalid_grant", "Invalid refresh token.");
  if (row.clientId !== client.id) throw new OAuthTokenError("invalid_grant", "Refresh token was issued to another client.");
  const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).limit(1);
  if (!grant) throw new OAuthTokenError("invalid_grant", "Authorization not found.");

  if (row.rotatedAt) {
    await db.update(oauthGrants).set({ revokedAt: new Date() }).where(eq(oauthGrants.id, grant.id));
    await revokeGrantTokens(grant);
    throw new OAuthTokenError("invalid_grant", "Refresh token reuse detected — the authorization was revoked.");
  }
  if (row.revokedAt) throw new OAuthTokenError("invalid_grant", "Refresh token was revoked.");
  if (row.expiresAt.getTime() < Date.now()) throw new OAuthTokenError("invalid_grant", "Refresh token expired.");
  await assertGrantUsable(grant);

  let scopes = row.scopes.filter((s) => grant.scopes.includes(s));
  const requested = body.get("scope");
  if (requested) {
    const req = parseScopes(requested);
    const extra = req.filter((s) => !scopes.includes(s));
    if (extra.length) throw new OAuthTokenError("invalid_scope", `Scope exceeds the original grant: ${extra.join(" ")}`);
    scopes = req;
  }
  if (!scopes.includes("read")) scopes = ["read", ...scopes];

  const [claimed] = await db
    .update(oauthRefreshTokens)
    .set({ rotatedAt: new Date() })
    .where(and(eq(oauthRefreshTokens.id, row.id), isNull(oauthRefreshTokens.rotatedAt)))
    .returning();
  if (!claimed) throw new OAuthTokenError("invalid_grant", "Refresh token was already used.");
  return issueTokens(client, grant, scopes);
}

/** RFC 7009 token revocation (always succeeds from the client's point of view). */
export async function revokeToken(client: OAuthClient, token: string) {
  const hash = hashSecret(token);
  if (token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) {
    const [row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(and(eq(oauthRefreshTokens.tokenHash, hash), eq(oauthRefreshTokens.clientId, client.id)))
      .limit(1);
    if (!row) return;
    const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).limit(1);
    if (grant) {
      await db.update(oauthGrants).set({ revokedAt: new Date() }).where(eq(oauthGrants.id, grant.id));
      await revokeGrantTokens(grant);
    }
    return;
  }
  if (token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.kind, "oauth"), eq(apiKeys.oauthClientId, client.id)));
  }
}
