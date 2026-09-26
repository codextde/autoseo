"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { instances } from "@/server/db/schema";
import { assertUser, AuthError } from "@/server/auth/guards";
import { checkSlugAvailability, getUserInstance } from "@/server/instances";
import { instanceHost } from "@/server/compose";
import { getSetting } from "@/server/settings";
import { BillingError, createCheckoutSession, createPortalSession, expireCheckoutSession } from "@/server/stripe";
import { isSubscriptionLive, subscriptionAction } from "@/server/billing-rules";
import { restartInstance, retryProvisioning } from "@/server/provisioning";
import { instanceSsoRedirect } from "@/server/instance-access";
import { rateLimit } from "@/server/rate-limit";
import { logEvent } from "@/server/events";

export type InstanceActionState = { error?: string; message?: string };

function failure(err: unknown): InstanceActionState {
  if (err instanceof AuthError || err instanceof BillingError) return { error: err.message };
  console.error("[instance action]", err);
  return { error: "Something went wrong. Please try again or contact support." };
}

const startSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, "Choose an address."),
  workspaceName: z.string().trim().min(1, "Enter a workspace name.").max(80, "Use at most 80 characters."),
});

/** "Continue to payment": reserves the address (pending_payment) and sends the customer to Stripe Checkout. */
export async function startCheckoutAction(_prev: InstanceActionState, formData: FormData): Promise<InstanceActionState> {
  let checkoutUrl: string;
  try {
    const { user } = await assertUser();
    if (!rateLimit(`checkout:${user.id}`, 20, 60 * 60 * 1000)) return { error: "Too many attempts. Please wait a moment." };
    const parsed = startSchema.safeParse({ slug: formData.get("slug"), workspaceName: formData.get("workspaceName") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

    let instance = await getUserInstance(user.id);
    if (instance && instance.status !== "pending_payment") return { error: "You already have an instance." };
    const availability = await checkSlugAvailability(parsed.data.slug, instance?.id);
    if (!availability.available) return { error: availability.error };

    const coolify = await getSetting("coolify");
    const host = instanceHost(availability.slug, coolify.baseDomain);
    let created = false;
    if (instance) {
      [instance] = await db
        .update(instances)
        .set({ slug: availability.slug, host, workspaceName: parsed.data.workspaceName })
        .where(eq(instances.id, instance.id))
        .returning();
    } else {
      try {
        [instance] = await db
          .insert(instances)
          .values({ userId: user.id, slug: availability.slug, host, workspaceName: parsed.data.workspaceName })
          .returning();
        created = true;
      } catch {
        return { error: "This address was just taken. Please choose another one." };
      }
      await logEvent("instance.reserved", { userId: user.id, instanceId: instance!.id, data: { slug: availability.slug } });
    }

    try {
      checkoutUrl = await createCheckoutSession(user, instance!);
    } catch (err) {
      // Don't keep a reservation the customer never got to pay for.
      if (created) await db.delete(instances).where(eq(instances.id, instance!.id));
      throw err;
    }
  } catch (err) {
    return failure(err);
  }
  redirect(checkoutUrl);
}

/** Pending payment → back to Stripe Checkout; stopped → resubscribe for the same instance and data. */
export async function resumeCheckoutAction(): Promise<InstanceActionState> {
  let checkoutUrl: string;
  try {
    const { user } = await assertUser();
    const instance = await getUserInstance(user.id);
    if (!instance || !["pending_payment", "stopped"].includes(instance.status)) return { error: "There is nothing to pay for." };
    if (instance.status === "stopped" && isSubscriptionLive(instance.subscriptionStatus) && subscriptionAction(instance.subscriptionStatus) !== "stop") {
      return { error: "Your subscription is still active — use “Manage billing” instead." };
    }
    checkoutUrl = await createCheckoutSession(user, instance);
  } catch (err) {
    return failure(err);
  }
  redirect(checkoutUrl);
}

/** Cancels an unpaid reservation (releases the address). */
export async function cancelPendingAction(): Promise<InstanceActionState> {
  try {
    const { user } = await assertUser();
    const instance = await getUserInstance(user.id);
    if (!instance || instance.status !== "pending_payment") return { error: "There is no pending order." };
    if (instance.stripeCheckoutSessionId) await expireCheckoutSession(instance.stripeCheckoutSessionId);
    await db.delete(instances).where(and(eq(instances.id, instance.id), eq(instances.status, "pending_payment")));
    await logEvent("instance.reservation_canceled", { userId: user.id, instanceId: instance.id, data: { slug: instance.slug } });
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { message: "Order canceled." };
}

/** "Open AutoSEO": one-click sign-in via a short-lived SSO token. */
export async function openInstanceAction(): Promise<InstanceActionState> {
  let target: string | null;
  try {
    const { user } = await assertUser();
    target = await instanceSsoRedirect(user);
  } catch (err) {
    return failure(err);
  }
  if (!target) return { error: "Your instance isn't running right now." };
  redirect(target);
}

export async function manageBillingAction(): Promise<InstanceActionState> {
  let url: string;
  try {
    const { user } = await assertUser();
    url = await createPortalSession(user);
  } catch (err) {
    return failure(err);
  }
  redirect(url);
}

export async function restartMyInstanceAction(): Promise<InstanceActionState> {
  try {
    const { user } = await assertUser();
    const instance = await getUserInstance(user.id);
    if (!instance || !["running", "provisioning"].includes(instance.status) || !instance.coolifyServiceUuid) {
      return { error: "Your instance can't be restarted right now." };
    }
    if (!rateLimit(`restart:${user.id}`, 5, 60 * 60 * 1000)) return { error: "Too many restarts. Please wait a while." };
    const res = await restartInstance(instance, `customer:${user.id}`);
    if (!res.ok) return { error: "The restart failed. Please try again or contact support." };
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { message: "Restarting — this takes about a minute." };
}

/** Failed setup: try again (only with a live subscription). */
export async function retryMyInstanceAction(): Promise<InstanceActionState> {
  try {
    const { user } = await assertUser();
    const instance = await getUserInstance(user.id);
    if (!instance || instance.status !== "failed") return { error: "There is nothing to retry." };
    if (subscriptionAction(instance.subscriptionStatus) !== "run") return { error: "Your subscription isn't active." };
    if (!rateLimit(`retry:${user.id}`, 5, 60 * 60 * 1000)) return { error: "Too many attempts. Please wait a while or contact support." };
    await retryProvisioning(instance.id, `customer:${user.id}`);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { message: "Retrying the setup…" };
}
