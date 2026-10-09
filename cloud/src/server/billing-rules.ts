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

/**
 * What to do with an instance in `current` state when its subscription asks for `action`.
 * An instance an admin stopped stays stopped; an unpaid reservation stays pending (housekeeping releases it);
 * a complimentary (not billed) instance is never stopped by billing.
 */
export function instanceTransition(
  current: InstanceStatus,
  action: SubscriptionAction,
  opts: { stoppedByAdmin?: boolean; complimentary?: boolean } = {},
): InstanceTransition {
  if (current === "deleted" || action === "none") return "none";
  if (action === "stop" && opts.complimentary) return "none";
  if (action === "run") {
    if (current === "pending_payment") return "provision";
    if (current === "stopped") return opts.stoppedByAdmin ? "none" : "start";
    return "none"; // provisioning / running / failed (admin or customer retries a failed one)
  }
  // stop
  if (current === "running" || current === "provisioning" || current === "failed") return "stop";
  return "none";
}

/**
 * A completed checkout whose subscription is already attached to the instance was processed long ago (e.g. the
 * original checkout of a subscription that has since been canceled). It is history, not a pending payment.
 */
export function isProcessedCheckout(
  sessionStatus: string | null,
  sessionSubscriptionId: string | null,
  instance: { stripeSubscriptionId: string | null; status: string },
): boolean {
  return (
    sessionStatus === "complete" &&
    !!sessionSubscriptionId &&
    sessionSubscriptionId === instance.stripeSubscriptionId &&
    instance.status !== "pending_payment"
  );
}

export type CheckoutOutcome = "open" | "paid" | "clear";

/**
 * What a stored Checkout Session means for its reservation:
 * - "open": can still be paid (expire it before dropping the reservation),
 * - "paid": completed with a subscription that is still alive — process it, never drop the reservation,
 * - "clear": expired, already processed history, or paid but the subscription died (incomplete_expired /
 *   canceled) — the reservation may be released or re-checked-out.
 */
export function classifyCheckout(
  session: { status: string | null; subscriptionId: string | null },
  subscriptionStatus: string | null,
  instance: { stripeSubscriptionId: string | null; status: string },
): CheckoutOutcome {
  if (session.status === "open") return "open";
  if (session.status !== "complete") return "clear";
  if (isProcessedCheckout(session.status, session.subscriptionId, instance)) return "clear";
  if (session.subscriptionId && subscriptionStatus && !isSubscriptionLive(subscriptionStatus)) return "clear";
  return "paid";
}

/**
 * A complimentary instance stays complimentary until a paid subscription (active / trialing / past_due) attaches;
 * from then on it is billed and follows the normal subscription rules.
 */
export function complimentaryAfterSubscription(complimentary: boolean, subscriptionStatus: string | null | undefined): boolean {
  return complimentary && subscriptionAction(subscriptionStatus) !== "run";
}

/** Unpaid reservations are released `ttlMs` after they were made; complimentary instances never are. */
export function isReleasableReservation(
  instance: { status: InstanceStatus; complimentary: boolean; createdAt: Date },
  now: number,
  ttlMs: number,
): boolean {
  return instance.status === "pending_payment" && !instance.complimentary && now - instance.createdAt.getTime() > ttlMs;
}

/**
 * The Stripe account is shared with other Codext products. Only checkouts created here carry an instanceId and
 * userId; any other checkout belongs to another product and must be left alone (never canceled as an orphan).
 */
export function isOwnCheckout(session: { metadata?: Record<string, string> | null }): boolean {
  return Boolean(session.metadata?.instanceId && session.metadata?.userId);
}
