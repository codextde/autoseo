// Schema for the "platform-api" module (OAuth 2.1 authorization server for MCP clients).
// API keys and OAuth access tokens live in `api_keys` (core.ts, kind "api" | "oauth").
import { pgTable, text, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, ts } from "./_helpers";
import { users, workspaces } from "./core";

export type OAuthScope = "read" | "write" | "spend" | "export";

/** Dynamically registered OAuth clients (RFC 7591) — Claude, ChatGPT, Cursor, VS Code… */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    /** Public client identifier (`client_id`). */
    id: id("ocl"),
    name: text().notNull(),
    redirectUris: jsonb().$type<string[]>().notNull().default([]),
    grantTypes: jsonb().$type<string[]>().notNull().default(["authorization_code", "refresh_token"]),
    responseTypes: jsonb().$type<string[]>().notNull().default(["code"]),
    /** "none" = public client (PKCE only); otherwise a hashed client secret is stored. */
    tokenEndpointAuthMethod: text({ enum: ["none", "client_secret_post", "client_secret_basic"] })
      .notNull()
      .default("none"),
    clientSecretHash: text(),
    /** Space-separated scopes the client asked for at registration (informational). */
    scope: text(),
    clientUri: text(),
    logoUri: text(),
    softwareId: text(),
    softwareVersion: text(),
    /** Full registration metadata as sent by the client (sanitised). */
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    registrationIp: text(),
    lastUsedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_clients_created_idx").on(t.createdAt)],
);

/**
 * A user's consent for a client in one workspace ("connected app"). Revoking the grant revokes
 * every refresh token and access token issued under it.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id("ogr"),
    clientId: text()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopes: jsonb().$type<OAuthScope[]>().notNull().default(["read"]),
    /** null = all projects the user can access in the workspace */
    projectIds: jsonb().$type<string[] | null>(),
    /** RFC 8707 resource indicator the client asked for (e.g. <app>/api/mcp). */
    resource: text(),
    lastUsedAt: ts(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index("oauth_grants_user_idx").on(t.userId, t.workspaceId),
    index("oauth_grants_client_idx").on(t.clientId),
  ],
);

/** Short-lived, single-use authorization codes (hash only) bound to a PKCE S256 challenge. */
export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: id("oac"),
    codeHash: text().notNull(),
    grantId: text()
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    clientId: text().notNull(),
    userId: text().notNull(),
    redirectUri: text().notNull(),
    /** true when the client sent redirect_uri explicitly (then the token request must repeat it). */
    redirectUriExplicit: text({ enum: ["yes", "no"] }).notNull().default("yes"),
    codeChallenge: text().notNull(),
    codeChallengeMethod: text({ enum: ["S256"] }).notNull().default("S256"),
    scopes: jsonb().$type<OAuthScope[]>().notNull(),
    resource: text(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_codes_hash_uq").on(t.codeHash)],
);

/** Rotating refresh tokens (hash only). A reused (already rotated) token revokes the whole grant. */
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: id("ort"),
    tokenHash: text().notNull(),
    grantId: text()
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    clientId: text().notNull(),
    userId: text().notNull(),
    scopes: jsonb().$type<OAuthScope[]>().notNull(),
    expiresAt: ts().notNull(),
    rotatedAt: ts(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_refresh_hash_uq").on(t.tokenHash), index("oauth_refresh_grant_idx").on(t.grantId)],
);
