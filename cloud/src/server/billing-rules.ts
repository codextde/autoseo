/**
 * How Stripe subscription states drive instances (docs/MANAGED_INSTANCES.md → Lifecycle).
 * Pure so the mapping can be unit tested.
 */
import type { InstanceStatus } from "@/server/db/schema";

export type SubscriptionAction = "run" | "stop" | "none";

const RUN = new Set(["active", "trialing", "past_due"]);
const STOP = new Set(["unpaid", "canceled", "incomplete_expired", "paused"]);
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

export function subscriptionAction(status: string | null | undefined): SubscriptionAction {
  if (!status) return "none";
  if (RUN.has(status)) return "run";
  if (STOP.has(status)) return "stop";
  return "none"; // incomplete: wait for the first payment to settle
}

/** Subscription states that count as "has an active subscription" (blocks account deletion). */
export function isSubscriptionLive(status: string | null | undefined): boolean {
  return !!status && !TERMINAL.has(status);
}

/**
 * Whether a subscription event may update an instance. A resubscribe creates a new subscription for the
 * same instance, so late events of the old (canceled) subscription must not stop the new one.
 */
export function shouldApplySubscription(
  instance: { stripeSubscriptionId: string | null; subscriptionStatus: string | null },
  sub: { id: string; status: string },
): boolean {
  if (!instance.stripeSubscriptionId || instance.stripeSubscriptionId === sub.id) return true;
  // A different subscription replaces the stored one only if the stored one is over and the new one is not.
  return TERMINAL.has(instance.subscriptionStatus ?? "") && !TERMINAL.has(sub.status);
}

export type InstanceTransition = "provision" | "start" | "stop" | "none";

/** What to do with an instance in `current` state when its subscription asks for `action`. */
export function instanceTransition(current: InstanceStatus, action: SubscriptionAction): InstanceTransition {
  if (current === "deleted" || action === "none") return "none";
  if (action === "run") {
    if (current === "pending_payment") return "provision";
    if (current === "stopped") return "start";
    return "none"; // provisioning / running / failed (admin or customer retries a failed one)
  }
  // stop
  if (current === "running" || current === "provisioning" || current === "failed") return "stop";
  if (current === "pending_payment") return "stop";
  return "none";
}
