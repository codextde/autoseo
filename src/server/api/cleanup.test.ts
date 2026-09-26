import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { oauthClients } from "@/server/db/schema";
import { cleanupPlatformApi } from "./cleanup";

describe("platform-api cleanup (integration, dev DB)", () => {
  const ids: string[] = [];
  afterAll(async () => {
    for (const id of ids) await db.delete(oauthClients).where(eq(oauthClients.id, id));
  });

  it("purges stale never-authorized client registrations but keeps fresh ones", async () => {
    const [stale] = await db
      .insert(oauthClients)
      .values({ name: "stale test client", redirectUris: ["https://a.example/cb"], createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .returning();
    const [fresh] = await db.insert(oauthClients).values({ name: "fresh test client", redirectUris: ["https://a.example/cb"] }).returning();
    ids.push(stale!.id, fresh!.id);
    const res = await cleanupPlatformApi();
    expect(res.clients).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(oauthClients).where(eq(oauthClients.id, stale!.id))).toHaveLength(0);
    expect(await db.select().from(oauthClients).where(eq(oauthClients.id, fresh!.id))).toHaveLength(1);
  });
});
