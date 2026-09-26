import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, sessions } from "@/server/db/schema";
import { logEvent } from "@/server/events";
import { purgeExpiredLoginTokens } from "@/server/auth/login";
import {
  checkInstanceHealth,
  markInstanceHealthy,
  markInstanceUnhealthy,
  markStartTimedOut,
  provisionInstance,
  START_TIMEOUT_MS,
} from "@/server/provisioning";

const TICK_MS = 30_000;
const RUNNING_CHECK_MS = 10 * 60 * 1000;
const HOUSEKEEPING_MS = 60 * 60 * 1000;
/** Checkout sessions expire after 24 h; unpaid reservations release their address after that. */
const PENDING_TTL_MS = 25 * 60 * 60 * 1000;

declare global {
  var __cloudReconciler: { timer: NodeJS.Timeout; busy: boolean; lastRunningCheck: number; lastHousekeeping: number } | undefined;
}

/** Advances provisioning instances (resume, health → running, timeout → failed). */
async function reconcileProvisioning() {
  const rows = await db.select().from(instances).where(eq(instances.status, "provisioning"));
  const now = Date.now();
  for (const row of rows) {
    if (!row.startRequestedAt) {
      // Not started yet: (re)run provisioning unless we are in a backoff window.
      if (!row.nextProvisionAt || row.nextProvisionAt.getTime() <= now) await provisionInstance(row.id, "reconciler");
      continue;
    }
    if (await checkInstanceHealth(row.host)) {
      await markInstanceHealthy(row);
    } else if (now - row.startRequestedAt.getTime() > START_TIMEOUT_MS) {
      await markStartTimedOut(row);
    }
  }
}

async function checkRunningInstances() {
  const rows = await db.select().from(instances).where(eq(instances.status, "running"));
  for (const row of rows) {
    if (await checkInstanceHealth(row.host)) await markInstanceHealthy(row);
    else await markInstanceUnhealthy(row);
  }
}

async function housekeeping() {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  const stale = await db
    .delete(instances)
    .where(and(eq(instances.status, "pending_payment"), isNull(instances.stripeSubscriptionId), lt(instances.createdAt, cutoff)))
    .returning({ id: instances.id, slug: instances.slug, userId: instances.userId });
  for (const s of stale) await logEvent("instance.reservation_expired", { instanceId: s.id, userId: s.userId, data: { slug: s.slug } });
  await purgeExpiredLoginTokens();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

async function tick() {
  const state = globalThis.__cloudReconciler;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    await reconcileProvisioning();
    const now = Date.now();
    if (now - state.lastRunningCheck >= RUNNING_CHECK_MS) {
      state.lastRunningCheck = now;
      await checkRunningInstances();
    }
    if (now - state.lastHousekeeping >= HOUSEKEEPING_MS) {
      state.lastHousekeeping = now;
      await housekeeping();
    }
  } catch (err) {
    console.error("[reconciler] tick failed", err);
  } finally {
    state.busy = false;
  }
}

/** Starts the single background loop (guarded on globalThis so hot reloads don't start a second one). */
export function startReconciler(): void {
  if (globalThis.__cloudReconciler) return;
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  globalThis.__cloudReconciler = { timer, busy: false, lastRunningCheck: 0, lastHousekeeping: 0 };
  setTimeout(() => void tick(), 5_000).unref?.();
  console.info(`[reconciler] started (every ${TICK_MS / 1000}s)`);
}
