import "server-only";
import Stripe from "stripe";
import { after } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users, type Instance, type User } from "@/server/db/schema";
import { appUrl } from "@/server/http";
import { logEvent } from "@/server/events";
import { getSetting, isStripeConnected, STRIPE_PRICE_LOOKUP_KEY, updateSetting, type StripeSettings } from "@/server/settings";
import { instanceTransition, isSubscriptionLive, shouldApplySubscription, subscriptionAction } from "@/server/billing-rules";
import { checkSlugAvailability, getInstance, getInstanceBySubscription, getUserInstance } from "@/server/instances";
import { instanceHost } from "@/server/compose";
import { provisionInstance, stopInstance } from "@/server/provisioning";
import { sendMail } from "@/server/email";
import { paymentFailedEmail } from "@/server/email/templates";

/** Marks every Stripe object this app creates, so setup can find (and only ever replace) its own. */
const APP_TAG = "autoseo-cloud";
const PRICE_CENTS = 5000;
const PRODUCT_NAME = "AutoSEO Cloud";
/** Stripe Tax code for "Software as a service (SaaS) — business use". */
const SAAS_TAX_CODE = "txcd_10103000";

export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
] as const satisfies Stripe.WebhookEndpointCreateParams.EnabledEvent[];

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

/** The stored checkout was already paid (its webhook hadn't been processed yet) — it has been now. */
export class CheckoutAlreadyPaidError extends BillingError {
  constructor() {
    super("Your payment went through — your instance is being set up.");
    this.name = "CheckoutAlreadyPaidError";
  }
}

/** Checkout sessions stay payable for 2 hours ("Resume checkout" creates a fresh one afterwards). */
const CHECKOUT_TTL_SECONDS = 2 * 60 * 60;

/**
 * Runs slow follow-up work after the response when called from a request (webhook, redirect, action), or
 * right away from the background reconciler, where Next.js' `after()` has no request scope.
 */
function runAfterResponse(task: () => Promise<unknown>) {
  const guarded = () => task().catch((err) => console.error("[stripe] follow-up task failed", err));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

export function stripeModeFromKey(key: string): "live" | "test" | null {
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

function createClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "AutoSEO Cloud", url: "https://autoseo.codext.de" },
  });
}

async function stripeClient(): Promise<{ stripe: Stripe; settings: StripeSettings }> {
  const settings = await getSetting("stripe");
  if (!settings.secretKey) throw new BillingError("Billing is not set up yet. Please try again later or contact support.");
  return { stripe: createClient(settings.secretKey), settings };
}

export function webhookUrl(): string {
  return appUrl("/api/stripe/webhook");
}

function stripeMessage(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) return `${err.message}${err.code ? ` (${err.code})` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

/* ─────────────────────────────── Setup ("Connect") ─────────────────────────────── */

export type StripeSetupResult = { ok: true; settings: StripeSettings } | { ok: false; error: string };

/**
 * Idempotent account setup: product + monthly price (by lookup key), webhook endpoint (with its signing
 * secret stored encrypted) and a customer portal configuration. Safe to run any number of times.
 */
export async function connectStripe(): Promise<StripeSetupResult> {
  const current = await getSetting("stripe");
  if (!current.secretKey) return { ok: false, error: "Enter a Stripe secret key first." };
  const stripe = createClient(current.secretKey);
  const steps: string[] = [];
  try {
    let accountName = "";
    try {
      const account = await stripe.accounts.retrieveCurrent();
      accountName = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id;
    } catch {
      // Restricted keys may not read the account; not required.
    }

    // 1. Product + price — an existing price with the lookup key (and its product) is always reused.
    let price = (await stripe.prices.list({ lookup_keys: [STRIPE_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
    if (!price) {
      const products = await stripe.products.list({ active: true, limit: 100 });
      const product =
        products.data.find((p) => p.metadata?.app === APP_TAG) ??
        products.data.find((p) => p.name === PRODUCT_NAME) ??
        (await stripe.products.create({
          name: PRODUCT_NAME,
          description: "Your own private, fully managed AutoSEO instance",
          tax_code: SAAS_TAX_CODE,
          metadata: { app: APP_TAG },
        }));
      price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: PRICE_CENTS,
        recurring: { interval: "month" },
        tax_behavior: "exclusive",
        lookup_key: STRIPE_PRICE_LOOKUP_KEY,
        nickname: "AutoSEO Cloud monthly",
        metadata: { app: APP_TAG },
      });
      steps.push("created product + price");
    }
    const productId = typeof price.product === "string" ? price.product : price.product.id;

    // 2. Webhook endpoint
    const url = webhookUrl();
    const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url);
    let webhookEndpointId = current.webhookEndpointId;
    let webhookSecret = current.webhookSecret;
    const known = endpoints.find((e) => e.id === current.webhookEndpointId);
    if (known && webhookSecret) {
      await stripe.webhookEndpoints.update(known.id, { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
    } else {
      // We can't read the signing secret of an existing endpoint: replace the one we own.
      for (const e of endpoints.filter((e) => e.metadata?.app === APP_TAG)) await stripe.webhookEndpoints.del(e.id);
      const created = await stripe.webhookEndpoints.create({
        url,
        enabled_events: [...WEBHOOK_EVENTS],
        api_version: Stripe.API_VERSION,
        description: "AutoSEO Cloud (managed automatically — do not edit)",
        metadata: { app: APP_TAG },
      });
      if (!created.secret) throw new Error("Stripe did not return a webhook signing secret.");
      webhookEndpointId = created.id;
      webhookSecret = created.secret;
      steps.push("created webhook endpoint");
    }

    // 3. Customer portal
    const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
    };
    const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    let portal = configs.data.find((c) => c.metadata?.app === APP_TAG);
    if (portal) {
      portal = await stripe.billingPortal.configurations.update(portal.id, { features, default_return_url: appUrl("/dashboard") });
    } else {
      portal = await stripe.billingPortal.configurations.create({
        name: "AutoSEO Cloud",
        features,
        business_profile: { headline: "AutoSEO Cloud — manage your subscription" },
        default_return_url: appUrl("/dashboard"),
        metadata: { app: APP_TAG },
      });
      steps.push("created billing portal configuration");
    }

    const settings = await updateSetting("stripe", {
      mode: stripeModeFromKey(current.secretKey),
      accountName,
      productId,
      priceId: price.id,
      webhookEndpointId,
      webhookSecret,
      portalConfigurationId: portal.id,
      connectedAt: new Date().toISOString(),
      lastError: "",
    });
    await logEvent("stripe.connected", { data: { mode: settings.mode, priceId: price.id, webhookEndpointId, portal: portal.id, steps } });
    return { ok: true, settings };
  } catch (err) {
    const error = stripeMessage(err);
    await updateSetting("stripe", { lastError: error });
    await logEvent("stripe.connect_failed", { data: { error } });
    return { ok: false, error };
  }
}

/* ─────────────────────────────── Checkout & portal ─────────────────────────────── */

async function ensureCustomer(stripe: Stripe, user: User): Promise<string> {
  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) return existing.id;
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
    }
  }
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name ?? undefined, metadata: { userId: user.id, app: APP_TAG } },
    { idempotencyKey: `customer-${user.id}-${user.stripeCustomerId ?? "new"}` },
  );
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id));
  await logEvent("stripe.customer_created", { userId: user.id, data: { customerId: customer.id } });
  return customer.id;
}

/** Returns the Checkout URL for a `pending_payment` (or stopped, for resubscribing) instance. */
export async function createCheckoutSession(user: User, instance: Instance): Promise<string> {
  const { stripe, settings } = await stripeClient();
  if (!isStripeConnected(settings)) throw new BillingError("Billing is not set up yet. Please try again later or contact support.");
  try {
    if (instance.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(instance.stripeCheckoutSessionId).catch(() => null);
      // Reuse a still-open session ("Resume checkout")…
      if (existing?.status === "open" && existing.url) return existing.url;
      // …and never start a second checkout for one that was paid but not processed yet.
      if (existing?.status === "complete") {
        await processCheckoutSession(existing, "resume");
        throw new CheckoutAlreadyPaidError();
      }
    }
    const price = (await stripe.prices.list({ lookup_keys: [STRIPE_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
    const priceId = price?.id ?? settings.priceId;
    const customer = await ensureCustomer(stripe, user);
    const metadata = {
      userId: user.id,
      instanceId: instance.id,
      slug: instance.slug,
      workspaceName: instance.workspaceName.slice(0, 450),
    };
    // One free trial per customer: none on resubscribes or for customers who had a subscription before.
    const trial = settings.trialDays > 0 && !(await hadSubscriptionBefore(stripe, customer, user.id));
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      subscription_data: {
        metadata,
        description: `AutoSEO Cloud — ${instance.host}`,
        ...(trial ? { trial_period_days: settings.trialDays } : {}),
      },
      success_url: appUrl("/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: appUrl("/dashboard?checkout=canceled"),
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      // Stripe requires name/address updates on an existing customer for tax id collection and automatic tax.
      customer_update: { address: "auto", name: "auto" },
      ...(settings.allowPromotionCodes ? { allow_promotion_codes: true } : {}),
      ...(settings.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    });
    await db.update(instances).set({ stripeCheckoutSessionId: session.id }).where(eq(instances.id, instance.id));
    await logEvent("billing.checkout_created", { userId: user.id, instanceId: instance.id, data: { sessionId: session.id } });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return session.url;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    const message = stripeMessage(err);
    await logEvent("billing.checkout_failed", { userId: user.id, instanceId: instance.id, data: { error: message } });
    throw new BillingError(`Could not start checkout: ${message}`);
  }
}

async function hadSubscriptionBefore(stripe: Stripe, customerId: string, userId: string): Promise<boolean> {
  const [previous] = await db
    .select({ id: instances.id })
    .from(instances)
    .where(and(eq(instances.userId, userId), isNotNull(instances.stripeSubscriptionId)))
    .limit(1);
  if (previous) return true;
  return (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 })).data.length > 0;
}

/**
 * Must run before a reservation is canceled, deleted or re-addressed: a checkout that was already paid is
 * processed (→ "paid", the caller must stop), an open one is expired so it can't be paid later (→ "clear").
 * Throws when Stripe can't be reached, so callers never drop a reservation they couldn't verify.
 */
export async function settleCheckoutSession(instance: Instance): Promise<"paid" | "clear"> {
  if (!instance.stripeCheckoutSessionId) return "clear";
  const { stripe } = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(instance.stripeCheckoutSessionId);
  if (session.status === "complete") {
    await processCheckoutSession(session, "settle");
    return "paid";
  }
  if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  return "clear";
}

export async function createPortalSession(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new BillingError("There is no billing account for this user yet.");
  const { stripe, settings } = await stripeClient();
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: appUrl("/dashboard"),
      ...(settings.portalConfigurationId ? { configuration: settings.portalConfigurationId } : {}),
    });
    return session.url;
  } catch (err) {
    throw new BillingError(`Could not open the billing portal: ${stripeMessage(err)}`);
  }
}

/** Admin delete: stop billing for an instance that is about to disappear. */
export async function cancelSubscriptionNow(instance: Instance, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!instance.stripeSubscriptionId || !isSubscriptionLive(instance.subscriptionStatus)) return { ok: true };
  try {
    const { stripe } = await stripeClient();
    await stripe.subscriptions.cancel(instance.stripeSubscriptionId);
    await logEvent("billing.subscription_canceled", { instanceId: instance.id, userId: instance.userId, data: { actor, subscriptionId: instance.stripeSubscriptionId } });
    return { ok: true };
  } catch (err) {
    const error = stripeMessage(err);
    await logEvent("billing.subscription_cancel_failed", { instanceId: instance.id, data: { actor, error } });
    return { ok: false, error };
  }
}

/* ─────────────────────────────── Sync (webhook + redirect) ─────────────────────────────── */

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

/**
 * A second live subscription for an instance that already has one (e.g. two checkouts completed in parallel):
 * cancel it so the customer isn't billed twice, and leave the refund to an admin.
 */
async function cancelDuplicateSubscription(stripe: Stripe, instance: Instance, sub: Stripe.Subscription, source: string) {
  if (!isSubscriptionLive(sub.status) || sub.metadata?.instanceId !== instance.id || !instance.stripeSubscriptionId) return;
  const current = await stripe.subscriptions.retrieve(instance.stripeSubscriptionId);
  if (!isSubscriptionLive(current.status)) return;
  await stripe.subscriptions.cancel(sub.id);
  console.error(`[stripe] canceled duplicate subscription ${sub.id} for instance ${instance.id} — refund it in Stripe`);
  await logEvent("billing.duplicate_subscription_canceled", {
    instanceId: instance.id,
    userId: instance.userId,
    data: { subscriptionId: sub.id, kept: instance.stripeSubscriptionId, source, action: "refund the first payment in Stripe" },
  });
}

/** Stores subscription state on the instance and starts/stops it accordingly (work runs after the response). */
async function applySubscription(stripe: Stripe, instance: Instance, sub: Stripe.Subscription, source: string): Promise<void> {
  if (!shouldApplySubscription(instance, sub)) {
    await logEvent("stripe.subscription_ignored", {
      instanceId: instance.id,
      data: { subscriptionId: sub.id, status: sub.status, current: instance.stripeSubscriptionId, source },
    });
    await cancelDuplicateSubscription(stripe, instance, sub, source);
    return;
  }
  const transition = instanceTransition(instance.status, subscriptionAction(sub.status), { stoppedByAdmin: instance.stoppedByAdmin });
  const statusChanged = instance.subscriptionStatus !== sub.status || instance.stripeSubscriptionId !== sub.id;
  await db
    .update(instances)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
      ...(transition === "provision" || transition === "start"
        ? { status: "provisioning" as const, error: null, startRequestedAt: null, provisionAttempts: 0, nextProvisionAt: null }
        : {}),
    })
    .where(eq(instances.id, instance.id));
  if (statusChanged) {
    await logEvent("billing.subscription_synced", {
      instanceId: instance.id,
      userId: instance.userId,
      data: { subscriptionId: sub.id, status: sub.status, transition, source },
    });
  }
  if (transition === "provision" || transition === "start") {
    runAfterResponse(() => provisionInstance(instance.id, `stripe:${source}`));
  } else if (transition === "stop") {
    runAfterResponse(async () => {
      const fresh = await getInstance(instance.id);
      if (fresh) await stopInstance(fresh, `stripe:${source}`, `subscription ${sub.status}`);
    });
  }
}

async function syncSubscriptionById(stripe: Stripe, subscriptionId: string, source: string, instanceHint?: Instance | null) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const instance =
    instanceHint ??
    (sub.metadata?.instanceId ? await getInstance(sub.metadata.instanceId) : null) ??
    (await getInstanceBySubscription(sub.id));
  if (!instance) {
    await logEvent("stripe.subscription_unmatched", { data: { subscriptionId, source } });
    return;
  }
  await applySubscription(stripe, instance, sub, source);
}

/**
 * A paid checkout whose reservation is gone (released or canceled while the customer was still paying):
 * recreate it from the session metadata when the address is still free, so the payment isn't lost.
 */
async function recreateReservation(session: Stripe.Checkout.Session): Promise<Instance | null> {
  const { instanceId, userId, slug, workspaceName } = session.metadata ?? {};
  if (!instanceId || !userId || !slug || session.client_reference_id !== userId) return null;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!owner || (await getUserInstance(userId))) return null;
  const availability = await checkSlugAvailability(slug);
  if (!availability.available) return null;
  const coolify = await getSetting("coolify");
  try {
    const [row] = await db
      .insert(instances)
      .values({
        id: instanceId,
        userId,
        slug: availability.slug,
        host: instanceHost(availability.slug, coolify.baseDomain),
        workspaceName: workspaceName || "My Workspace",
        stripeCheckoutSessionId: session.id,
      })
      .onConflictDoNothing()
      .returning();
    if (row) await logEvent("instance.reservation_restored", { instanceId, userId, data: { sessionId: session.id, slug } });
    const restored = row ?? (await getInstance(instanceId)); // a concurrent webhook/redirect may have won
    return restored && restored.status !== "deleted" ? restored : null;
  } catch {
    return null; // lost a race for the address
  }
}

/**
 * checkout.session.completed — also called from the success redirect in case the webhook is late.
 * Idempotent: applying the same subscription twice changes nothing.
 */
export async function processCheckoutSession(session: Stripe.Checkout.Session, source: string): Promise<Instance | null> {
  if (session.mode !== "subscription" || session.status !== "complete") return null;
  const instanceId = session.metadata?.instanceId;
  const existing = instanceId ? await getInstance(instanceId) : null;
  const instance = existing && existing.status !== "deleted" ? existing : await recreateReservation(session);
  if (!instance) {
    // Paid, but there is nothing to provision: needs an admin (refund or manual setup).
    console.error(`[stripe] paid checkout ${session.id} has no instance — resolve it manually`);
    await logEvent("stripe.checkout_unmatched", {
      userId: session.client_reference_id,
      data: { sessionId: session.id, subscription: idOf(session.subscription), source, action: "refund or set up manually" },
    });
    return null;
  }
  if (instance.userId && session.client_reference_id && session.client_reference_id !== instance.userId) {
    await logEvent("stripe.checkout_owner_mismatch", { instanceId: instance.id, data: { sessionId: session.id } });
    return null;
  }
  const customerId = idOf(session.customer);
  if (customerId && instance.userId) {
    const [owner] = await db.select().from(users).where(eq(users.id, instance.userId)).limit(1);
    if (owner && owner.stripeCustomerId !== customerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, owner.id));
    }
  }
  const subscriptionId = idOf(session.subscription);
  if (!subscriptionId) return instance;
  const { stripe } = await stripeClient();
  await syncSubscriptionById(stripe, subscriptionId, source, instance);
  return getInstance(instance.id);
}

/** Success redirect: fetch the session server-side and process it (only for its owner). */
export async function processCheckoutRedirect(sessionId: string, userId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  try {
    const { stripe } = await stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) return;
    await processCheckoutSession(session, "redirect");
  } catch (err) {
    console.error("[stripe] checkout redirect processing failed", err);
  }
}

async function handlePaymentFailed(stripe: Stripe, invoice: Stripe.Invoice) {
  const customerId = idOf(invoice.customer);
  const [user] = customerId ? await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1) : [];
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (subscriptionId) await syncSubscriptionById(stripe, subscriptionId, "invoice.payment_failed");
  if (!user) {
    await logEvent("stripe.invoice_unmatched", { data: { invoiceId: invoice.id, customerId } });
    return;
  }
  const instance = await getUserInstance(user.id);
  const amount =
    typeof invoice.amount_due === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: (invoice.currency || "usd").toUpperCase() }).format(invoice.amount_due / 100)
      : null;
  const mail = paymentFailedEmail({ billingUrl: appUrl("/api/billing/portal"), host: instance?.host ?? null, amount });
  const res = await sendMail({ to: user.email, ...mail });
  await logEvent("email.payment_failed", {
    userId: user.id,
    instanceId: instance?.id,
    data: { invoiceId: invoice.id, transport: res.transport, delivered: res.delivered, error: res.error },
  });
}

/** Verifies the signature against the stored signing secret. Throws on failure. */
export async function constructWebhookEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
  const settings = await getSetting("stripe");
  if (!settings.webhookSecret) throw new BillingError("Stripe webhook is not configured.");
  return Stripe.webhooks.constructEvent(rawBody, signature, settings.webhookSecret);
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const { stripe } = await stripeClient();
  switch (event.type) {
    case "checkout.session.completed":
      await processCheckoutSession(event.data.object, "webhook");
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const instance = (sub.metadata?.instanceId ? await getInstance(sub.metadata.instanceId) : null) ?? (await getInstanceBySubscription(sub.id));
      if (!instance) {
        await logEvent("stripe.subscription_unmatched", { data: { subscriptionId: sub.id, type: event.type } });
        break;
      }
      // Events can arrive out of order: always act on the current state from the API.
      const latest = event.type === "customer.subscription.deleted" ? sub : await stripe.subscriptions.retrieve(sub.id);
      await applySubscription(stripe, instance, latest, event.type);
      break;
    }
    case "invoice.payment_failed":
      await handlePaymentFailed(stripe, event.data.object);
      break;
    case "invoice.paid": {
      const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
      if (subscriptionId) await syncSubscriptionById(stripe, subscriptionId, "invoice.paid");
      break;
    }
    default:
      break;
  }
}
