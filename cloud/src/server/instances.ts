import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users, type Instance } from "@/server/db/schema";
import { validateSlug } from "@/server/slug";

/** The customer's current (not deleted) instance — one per account. */
export async function getUserInstance(userId: string): Promise<Instance | null> {
  const [row] = await db
    .select()
    .from(instances)
    .where(and(eq(instances.userId, userId), ne(instances.status, "deleted")))
    .orderBy(desc(instances.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getInstance(id: string): Promise<Instance | null> {
  const [row] = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  return row ?? null;
}

export async function getInstanceBySubscription(subscriptionId: string): Promise<Instance | null> {
  const [row] = await db
    .select()
    .from(instances)
    .where(eq(instances.stripeSubscriptionId, subscriptionId))
    .orderBy(desc(instances.createdAt))
    .limit(1);
  return row ?? null;
}

export type SlugAvailability = { available: true; slug: string } | { available: false; slug: string; error: string };

/** Format, reserved names, and uniqueness against every live instance (pending ones included). */
export async function checkSlugAvailability(raw: string, exceptInstanceId?: string): Promise<SlugAvailability> {
  const check = validateSlug(raw);
  if (!check.ok) return { available: false, slug: check.slug, error: check.error };
  const [taken] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(and(eq(instances.slug, check.slug), ne(instances.status, "deleted")))
    .limit(1);
  if (taken && taken.id !== exceptInstanceId) return { available: false, slug: check.slug, error: "This address is already taken." };
  return { available: true, slug: check.slug };
}

export async function listInstancesWithUsers() {
  return db
    .select({ instance: instances, user: users })
    .from(instances)
    .leftJoin(users, eq(users.id, instances.userId))
    .orderBy(desc(instances.createdAt));
}

export async function listUsersWithoutInstances() {
  const rows = await db
    .select({ user: users, instanceId: instances.id })
    .from(users)
    .leftJoin(instances, eq(instances.userId, users.id))
    .orderBy(desc(users.createdAt));
  return rows.filter((r) => !r.instanceId).map((r) => r.user);
}
