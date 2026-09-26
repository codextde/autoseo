import { afterAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, users, workspaceMembers } from "@/server/db/schema";
import { resolveCredential } from "./auth";
import { cleanupPlatformApi } from "./cleanup";
import { createEphemeralApiKey, listApiKeys, revokeApiKey, SESSION_KEY_MAX_TTL_MS } from "./keys";

describe("ephemeral session keys (integration, dev DB)", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await db.delete(apiKeys).where(eq(apiKeys.id, id));
  });

  it("creates hashed, capped, hidden session keys that auth accepts until revoked/expired", async () => {
    const [member] = await db.select({ userId: workspaceMembers.userId, workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).limit(1);
    if (!member) return; // fresh DB without setup
    const key = await createEphemeralApiKey({ ...member, projectIds: null, scopes: ["read"], ttlMs: 48 * 3600_000, label: "Agent chat · test" });
    created.push(key.id);
    expect(key.id.startsWith("aks_")).toBe(true);
    expect(key.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(SESSION_KEY_MAX_TTL_MS);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row!.keyHash).not.toContain(key.token);
    expect(row!.kind).toBe("session");

    const principal = await resolveCredential(key.token);
    expect(principal?.kind).toBe("session");
    expect((await listApiKeys(member.workspaceId)).some((k) => k.id === key.id)).toBe(false);

    // Expired → rejected.
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiKeys.id, key.id));
    expect(await resolveCredential(key.token)).toBeNull();

    // Revoke by id works for any kind.
    const key2 = await createEphemeralApiKey({ ...member, projectIds: null, scopes: ["read"], ttlMs: 60_000, label: "revoke test" });
    created.push(key2.id);
    expect(await resolveCredential(key2.token)).not.toBeNull();
    expect(await revokeApiKey(key2.id)).toEqual({ id: key2.id, name: "revoke test" });
    expect(await resolveCredential(key2.token)).toBeNull();

    // Cleanup purges session keys expired for more than a day.
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(apiKeys.id, key.id));
    const res = await cleanupPlatformApi();
    expect(res.sessionKeys).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(apiKeys).where(like(apiKeys.id, key.id))).toHaveLength(0);
  });
});
