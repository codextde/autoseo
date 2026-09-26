import "server-only";
import Stripe from "stripe";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users, type Instance, type User } from "@/server/db/schema";
import { appUrl } from "@/server/http";
import { logEvent } from "@/server/events";
import { getSetting, isStripeConnected, STRIPE_PRICE_LOOKUP_KEY, updateSetting, type StripeSettings } from "@/server/settings";
import { instanceTransition, isSubscriptionLive, shouldApplySubscription, subscriptionAction } from "@/server/billing-rules";
import { getInstance, getInstanceBySubscription, getUserInstance } from "@/server/instances";
import { provisionInstance, stopInstance } from "@/server/provisioning";
import { sendMail } from "@/server/email";
import { paymentFailedEmail } from "@/server/email/templates";

/** Marks every Stripe object this app creates, so setup can find (and only ever replace) its own. */
const APP_TAG = "autoseo-cloud";
const PRICE_CENTS = 5000;

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

    // 1. Product + price
    let price = (await stripe.prices.list({ lookup_keys: [STRIPE_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
    if (!price) {
      const products = await stripe.products.list({ active: true, limit: 100 });
      const product =
        products.data.find((p) => p.metadata?.app === APP_TAG) ??
        (await stripe.products.create({
          name: "AutoSEO Cloud",
          description: "Your own private, fully managed AutoSEO instance",
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
    // Reuse a still-open session (e.g. "Resume checkout").
    if (instance.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(instance.stripeCheckoutSessionId).catch(() => null);
      if (existing?.status === "open" && existing.url) return existing.url;
    }
    const price = (await stripe.prices.list({ lookup_keys: [STRIPE_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
    const priceId = price?.id ?? settings.priceId;
    const customer = await ensureCustomer(stripe, user);
    const metadata = { userId: user.id, instanceId: instance.id, slug: instance.slug };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: {
        metadata,
        description: `AutoSEO Cloud — ${instance.host}`,
        ...(settings.trialDays > 0 ? { trial_period_days: settings.trialDays } : {}),
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

/** Expires an open checkout session (customer canceled a pending instance). Best effort. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  try {
    const { stripe } = await stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
  } catch {
    // Unconfigured Stripe or already expired: nothing to do.
  }
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

/** Admin delete: stop billing for an instance that no longer exists. Best effort. */
export async function cancelSubscriptionNow(instance: Instance, actor: string): Promise<void> {
  if (!instance.stripeSubscriptionId || !isSubscriptionLive(instance.subscriptionStatus)) return;
  try {
    const { stripe } = await stripeClient();
    await stripe.subscriptions.cancel(instance.stripeSubscriptionId);
    await logEvent("billing.subscription_canceled", { instanceId: instance.id, userId: instance.userId, data: { actor, subscriptionId: instance.stripeSubscriptionId } });
  } catch (err) {
    await logEvent("billing.subscription_cancel_failed", { instanceId: instance.id, data: { actor, error: stripeMessage(err) } });
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

/** Stores subscription state on the instance and starts/stops it accordingly (work runs after the response). */
async function applySubscription(instance: Instance, sub: Stripe.Subscription, source: string): Promise<void> {
  if (!shouldApplySubscription(instance, sub)) {
    await logEvent("stripe.subscription_ignored", {
      instanceId: instance.id,
      data: { subscriptionId: sub.id, status: sub.status, current: instance.stripeSubscriptionId, source },
    });
    return;
  }
  const transition = instanceTransition(instance.status, subscriptionAction(sub.status));
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
    after(() => provisionInstance(instance.id, `stripe:${source}`));
  } else if (transition === "stop") {
    after(async () => {
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
  await applySubscription(instance, sub, source);
}

/**
 * checkout.session.completed — also called from the success redirect in case the webhook is late.
 * Idempotent: applying the same subscription twice changes nothing.
 */
export async function processCheckoutSession(session: Stripe.Checkout.Session, source: string): Promise<Instance | null> {
  if (session.mode !== "subscription" || session.status !== "complete") return null;
  const instanceId = session.metadata?.instanceId;
  const instance = instanceId ? await getInstance(instanceId) : null;
  if (!instance) {
    await logEvent("stripe.checkout_unmatched", { data: { sessionId: session.id, source } });
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
      await applySubscription(instance, latest, event.type);
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
