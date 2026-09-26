import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, sessions, stripeEvents } from "@/server/db/schema";
import { isSubscriptionLive } from "@/server/billing-rules";
import { settleCheckoutSession } from "@/server/stripe";
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
/** Unpaid reservations release their address this long after the last checkout was started. */
const PENDING_TTL_MS = 25 * 60 * 60 * 1000;
const STRIPE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

async function releaseStaleReservations() {
  // `updatedAt` moves whenever a new checkout session is stored, so a resumed checkout keeps its reservation.
  const stale = await db
    .select()
    .from(instances)
    .where(and(eq(instances.status, "pending_payment"), lt(instances.updatedAt, new Date(Date.now() - PENDING_TTL_MS))));
  for (const row of stale) {
    if (isSubscriptionLive(row.subscriptionStatus)) continue;
    try {
      // A late payment is processed instead of dropped; an open session is expired before the release.
      if ((await settleCheckoutSession(row)) === "paid") continue;
    } catch (err) {
      console.warn(`[reconciler] keeping reservation ${row.slug}: checkout could not be verified`, err);
      continue;
    }
    const [deleted] = await db
      .delete(instances)
      .where(and(eq(instances.id, row.id), eq(instances.status, "pending_payment")))
      .returning({ id: instances.id });
    if (deleted) await logEvent("instance.reservation_expired", { instanceId: row.id, userId: row.userId, data: { slug: row.slug } });
  }
}

async function housekeeping() {
  await releaseStaleReservations();
  await purgeExpiredLoginTokens();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db.delete(stripeEvents).where(lt(stripeEvents.createdAt, new Date(Date.now() - STRIPE_EVENT_RETENTION_MS)));
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
