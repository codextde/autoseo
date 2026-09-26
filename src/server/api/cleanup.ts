import "server-only";
import { and, eq, isNotNull, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, apiRequestLogs, oauthAuthorizationCodes, oauthClients, oauthGrants, oauthRefreshTokens } from "@/server/db/schema";

const DAY = 86_400_000;
export const REQUEST_LOG_RETENTION_DAYS = 180;

/**
 * Daily housekeeping: expired authorization codes, expired / revoked OAuth access and refresh
 * tokens, expired agent-session keys, never-authorized dynamically registered clients and old request logs.
 */
export async function cleanupPlatformApi() {
  const now = Date.now();
  const codes = await db
    .delete(oauthAuthorizationCodes)
    .where(lt(oauthAuthorizationCodes.expiresAt, new Date(now - DAY)))
    .returning({ id: oauthAuthorizationCodes.id });
  const accessTokens = await db
    .delete(apiKeys)
    .where(
      and(
        eq(apiKeys.kind, "oauth"),
        or(lt(apiKeys.expiresAt, new Date(now - 7 * DAY)), and(isNotNull(apiKeys.revokedAt), lt(apiKeys.revokedAt, new Date(now - 7 * DAY)))),
      ),
    )
    .returning({ id: apiKeys.id });
  const sessionKeys = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.kind, "session"), or(lt(apiKeys.expiresAt, new Date(now - DAY)), and(isNotNull(apiKeys.revokedAt), lt(apiKeys.revokedAt, new Date(now - DAY))))))
    .returning({ id: apiKeys.id });
  const refreshTokens = await db
    .delete(oauthRefreshTokens)
    .where(
      or(
        lt(oauthRefreshTokens.expiresAt, new Date(now - DAY)),
        lt(oauthRefreshTokens.rotatedAt, new Date(now - 7 * DAY)),
        lt(oauthRefreshTokens.revokedAt, new Date(now - 7 * DAY)),
      ),
    )
    .returning({ id: oauthRefreshTokens.id });
  const clients = await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, new Date(now - 30 * DAY)),
        notExists(db.select({ one: sql`1` }).from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id))),
      ),
    )
    .returning({ id: oauthClients.id });
  const logs = await db
    .delete(apiRequestLogs)
    .where(lt(apiRequestLogs.createdAt, new Date(now - REQUEST_LOG_RETENTION_DAYS * DAY)))
    .returning({ id: apiRequestLogs.id });
  return {
    codes: codes.length,
    accessTokens: accessTokens.length,
    sessionKeys: sessionKeys.length,
    refreshTokens: refreshTokens.length,
    clients: clients.length,
    requestLogs: logs.length,
  };
}
