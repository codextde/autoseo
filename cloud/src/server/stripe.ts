import "server-only";
import Stripe from "stripe";
import { after } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users, type Instance, type User } from "@/server/db/schema";
import { appUrl } from "@/server/http";
import { logEvent, logEventOnce } from "@/server/events";
import { stripeAttributionMetadata } from "@/server/analytics/attribution";
import { subscriptionMrr } from "@/server/mrr";
import { ANALYTICS_START } from "@/server/analytics/periods";
import {
  getSetting,
  isStripeConnected,
  STRIPE_PRICE_LOOKUP_KEY,
  STRIPE_YEARLY_PRICE_LOOKUP_KEY,
  updateSetting,
  type StripeSettings,
} from "@/server/settings";
import { isLaunchOfferOpen, launchOffer, offerStatus, spotsLeft, type BillingPlan, type LaunchOfferStatus } from "@/lib/launch-offer";
import {
  classifyCheckout,
  complimentaryAfterSubscription,
  instanceTransition,
  isOwnCheckout,
  isProcessedCheckout,
  isSubscriptionLive,
  shouldApplySubscription,
  subscriptionAction,
  type CheckoutOutcome,
} from "@/server/billing-rules";
import { getInstance, getInstanceBySubscription, getUserInstance } from "@/server/instances";
import { resolveInstanceAddress } from "@/server/instance-address";
import { provisionInstance, stopInstance } from "@/server/provisioning";
import { sendMail } from "@/server/email";
import { paymentFailedEmail } from "@/server/email/templates";

/** Marks every Stripe object this app creates, so setup can find (and only ever replace) its own. */
const APP_TAG = "autoseo-cloud";
const PRICE_CENTS = 5000;
const YEARLY_PRICE_CENTS = launchOffer.regularYearlyUsd * 100;
const SUPPORT_EMAIL = "info@codext.de";
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

/**
 * Creates our webhook endpoint on the SDK's API version. Stripe allows at most three distinct API versions across
 * an account's live endpoints; when that limit is reached (the account is shared with other apps) the newest
 * version already in use is reused instead. That is safe because the handler only takes object ids from events and
 * re-reads every object through the SDK's pinned version.
 */
async function createWebhookEndpoint(stripe: Stripe, url: string): Promise<Stripe.WebhookEndpoint> {
  const params = {
    url,
    enabled_events: [...WEBHOOK_EVENTS],
    description: "AutoSEO Cloud (managed automatically — do not edit)",
    metadata: { app: APP_TAG },
  };
  try {
    return await stripe.webhookEndpoints.create({ ...params, api_version: Stripe.API_VERSION });
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError) || !/unique versions/i.test(err.message)) throw err;
    const inUse = (await stripe.webhookEndpoints.list({ limit: 100 })).data
      .map((e) => e.api_version)
      .filter((v): v is string => !!v)
      .sort();
    const newest = inUse.at(-1) as Stripe.WebhookEndpointCreateParams.ApiVersion | undefined;
    return stripe.webhookEndpoints.create({ ...params, ...(newest ? { api_version: newest } : {}) });
  }
}

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
    const yearly = await ensureYearlyPrice(stripe, productId);
    if (yearly.created) steps.push("created yearly price");
    if (isLaunchOfferOpen(Date.now()) && (await ensureLaunchCoupon(stripe, productId)).created) steps.push("created launch offer coupon");

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
      const created = await createWebhookEndpoint(stripe, url);
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
        business_profile: {
          headline: "AutoSEO Cloud — manage your subscription",
          privacy_policy_url: appUrl("/privacy"),
          terms_of_service_url: appUrl("/terms"),
        },
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
      yearlyPriceId: yearly.price.id,
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

/* ─────────────────────────────── Yearly plan & launch offer ─────────────────────────────── */

/** The yearly price (by lookup key), created on first use so the offer works without re-running setup. */
async function ensureYearlyPrice(stripe: Stripe, productId: string): Promise<{ price: Stripe.Price; created: boolean }> {
  const existing = (await stripe.prices.list({ lookup_keys: [STRIPE_YEARLY_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
  // Only a price with the advertised terms is reused; anything else is replaced (the new one takes the lookup key).
  if (existing && existing.unit_amount === YEARLY_PRICE_CENTS && existing.currency === "usd" && existing.recurring?.interval === "year") {
    return { price: existing, created: false };
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: YEARLY_PRICE_CENTS,
    recurring: { interval: "year" },
    tax_behavior: "exclusive",
    lookup_key: STRIPE_YEARLY_PRICE_LOOKUP_KEY,
    // A concurrent first checkout may have created one too: the newest takes the key, both are identical.
    transfer_lookup_key: true,
    nickname: "AutoSEO Cloud yearly",
    metadata: { app: APP_TAG },
  });
  return { price, created: true };
}

function isMissing(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing";
}

function checkCouponTerms(coupon: Stripe.Coupon): Stripe.Coupon {
  if (coupon.percent_off !== launchOffer.percentOff || coupon.duration !== "once") {
    throw new Error(`Stripe coupon ${coupon.id} has different terms than the advertised offer — give site.launchOffer a new couponId.`);
  }
  return coupon;
}

/**
 * The launch offer coupon (fixed id, so creating it is idempotent): 50% off the first invoice of the yearly plan
 * only, redeemable until the deadline by the first `maxRedemptions` customers. Stripe marks it invalid afterwards.
 * Null once it was created and has since been deleted in Stripe (the way to end the offer early): it is never
 * recreated, which would restart the count of "the first 100 customers".
 */
async function ensureLaunchCoupon(stripe: Stripe, productId: string): Promise<{ coupon: Stripe.Coupon | null; created: boolean }> {
  try {
    return { coupon: checkCouponTerms(await stripe.coupons.retrieve(launchOffer.couponId)), created: false };
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  if ((await getSetting("stripe")).launchCouponCreatedAt) return { coupon: null, created: false };
  try {
    const coupon = await stripe.coupons.create({
      id: launchOffer.couponId,
      name: `Launch offer: ${launchOffer.percentOff}% off your first year`,
      percent_off: launchOffer.percentOff,
      duration: "once",
      max_redemptions: launchOffer.maxRedemptions,
      redeem_by: Math.floor(launchOffer.endsAtMs / 1000),
      // The Stripe account is shared with other products.
      applies_to: { products: [productId] },
      metadata: { app: APP_TAG },
    });
    await updateSetting("stripe", { launchCouponCreatedAt: new Date().toISOString() });
    return { coupon, created: true };
  } catch (err) {
    // Created by a concurrent checkout in the meantime.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_already_exists") {
      return { coupon: checkCouponTerms(await stripe.coupons.retrieve(launchOffer.couponId)), created: false };
    }
    throw err;
  }
}

let spotsCache: { spots: number | null; at: number } | null = null;
let spotsRequest: Promise<number | null> | null = null;
const OFFER_CACHE_MS = 60_000;

/** Spots left from the coupon's redemptions; null when unknown (billing not set up, Stripe unreachable). */
async function readSpotsLeft(): Promise<number | null> {
  let settings: StripeSettings | null = null;
  try {
    settings = await getSetting("stripe");
    if (!settings.secretKey) return null;
    const coupon = await createClient(settings.secretKey).coupons.retrieve(launchOffer.couponId);
    return coupon.valid ? spotsLeft(coupon.times_redeemed, coupon.max_redemptions ?? launchOffer.maxRedemptions) : 0;
  } catch (err) {
    // Not created yet (setup or the first yearly checkout creates it): nobody has redeemed it. Deleted after it
    // was created: the offer was ended early.
    if (isMissing(err)) return settings?.launchCouponCreatedAt ? 0 : launchOffer.maxRedemptions;
    console.error("[stripe] could not read the launch offer coupon", stripeMessage(err));
    return null;
  }
}

/**
 * Public state of the launch offer (deadline + spots left), with the Stripe lookup cached for a minute and shared
 * by concurrent requests. Never throws.
 */
export async function getLaunchOfferStatus(): Promise<LaunchOfferStatus> {
  if (Date.now() >= launchOffer.endsAtMs) return offerStatus(Date.now(), null);
  if (!spotsCache || Date.now() - spotsCache.at >= OFFER_CACHE_MS) {
    spotsRequest ??= readSpotsLeft()
      .then((spots) => {
        spotsCache = { spots, at: Date.now() };
        return spots;
      })
      .finally(() => {
        spotsRequest = null;
      });
    await spotsRequest;
  }
  return offerStatus(Date.now(), spotsCache?.spots ?? null);
}

const OFFER_ENDED = "The launch offer has just ended. You can still subscribe monthly.";

/** Price and discount for a new subscription; a yearly checkout is only offered with the launch discount. */
async function planLineItem(
  stripe: Stripe,
  settings: StripeSettings,
  plan: BillingPlan,
): Promise<{ priceId: string; coupon: string | null }> {
  const monthly = (await stripe.prices.list({ lookup_keys: [STRIPE_PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0];
  if (plan === "monthly") return { priceId: monthly?.id ?? settings.priceId, coupon: null };
  if (!isLaunchOfferOpen(Date.now())) throw new BillingError(OFFER_ENDED);
  const productId = settings.productId || (monthly && (typeof monthly.product === "string" ? monthly.product : monthly.product.id));
  if (!productId) throw new Error("No Stripe product for AutoSEO Cloud — run the Stripe setup in /admin.");
  const { price } = await ensureYearlyPrice(stripe, productId);
  const { coupon } = await ensureLaunchCoupon(stripe, productId);
  if (!coupon?.valid) {
    spotsCache = null;
    throw new BillingError(OFFER_ENDED);
  }
  return { priceId: price.id, coupon: coupon.id };
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
export async function createCheckoutSession(user: User, instance: Instance, plan: BillingPlan = "monthly"): Promise<string> {
  const { stripe, settings } = await stripeClient();
  if (!isStripeConnected(settings)) throw new BillingError("Billing is not set up yet. Please try again later or contact support.");
  let coupon: string | null = null;
  try {
    const existing = instance.stripeCheckoutSessionId
      ? await stripe.checkout.sessions.retrieve(instance.stripeCheckoutSessionId).catch(() => null)
      : null;
    const outcome = existing ? await checkoutOutcome(stripe, existing, instance) : "clear";
    // Never start a second checkout for one that was paid but not processed yet.
    if (outcome === "paid" && existing) {
      await processCheckoutSession(existing, "resume");
      throw new CheckoutAlreadyPaidError();
    }
    // Checked before an open session is reused or replaced: a yearly checkout needs the offer to still be open.
    const line = await planLineItem(stripe, settings, plan);
    coupon = line.coupon;
    // Reuse a still-open session for the same plan ("Resume checkout"); one for the other plan is replaced.
    if (outcome === "open" && existing?.url) {
      if ((existing.metadata?.plan ?? "monthly") === plan) return existing.url;
      await stripe.checkout.sessions.expire(existing.id);
    }
    const { priceId } = line;
    const customer = await ensureCustomer(stripe, user);
    const metadata = {
      userId: user.id,
      instanceId: instance.id,
      slug: instance.slug,
      backend: instance.backend,
      workspaceName: instance.workspaceName.slice(0, 450),
      plan,
      ...(coupon ? { offer: "launch50" } : {}),
      // Sign-up channel/campaign (attr_channel, attr_source, …), so revenue can be traced back to campaigns.
      ...stripeAttributionMetadata(user.attribution),
    };
    // One free trial per customer: none on resubscribes or for customers who had a subscription before. Never on
    // the discounted yearly plan, whose one-time coupon would otherwise be used up by the $0 trial invoice.
    const trial = plan === "monthly" && settings.trialDays > 0 && !(await hadSubscriptionBefore(stripe, customer, user.id));
    const now = Math.floor(Date.now() / 1000);
    // A discounted checkout stays payable at most until the offer ends (Stripe needs at least 30 minutes).
    const expiresAt = coupon
      ? Math.max(now + 31 * 60, Math.min(now + CHECKOUT_TTL_SECONDS, Math.floor(launchOffer.endsAtMs / 1000)))
      : now + CHECKOUT_TTL_SECONDS;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      expires_at: expiresAt,
      subscription_data: {
        metadata,
        description: `AutoSEO Cloud — ${instance.backend === "shared" ? instance.workspaceName : instance.host}`,
        ...(trial ? { trial_period_days: settings.trialDays } : {}),
      },
      // Processes the checkout, then continues to /dashboard?checkout=success (the session id never sits in a page URL).
      success_url: appUrl("/api/billing/return?session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: appUrl("/dashboard?checkout=canceled"),
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      // Stripe requires name/address updates on an existing customer for tax id collection and automatic tax.
      customer_update: { address: "auto", name: "auto" },
      // Stripe allows either a preset discount or promotion codes, not both.
      ...(coupon ? { discounts: [{ coupon }] } : settings.allowPromotionCodes ? { allow_promotion_codes: true } : {}),
      ...(settings.automaticTax ? { automatic_tax: { enabled: true } } : {}),
      // The Stripe account is shared with other products: brand this checkout as AutoSEO Cloud.
      branding_settings: {
        display_name: "AutoSEO Cloud",
        // Stripe fetches the icon, so only a public https URL works (not localhost during development).
        ...(appUrl().startsWith("https://") ? { icon: { type: "url" as const, url: appUrl("/apple-touch-icon.png") } } : {}),
        button_color: "#141413",
        background_color: "#ffffff",
        border_style: "rounded",
        font_family: "inter",
      },
    });
    await db.update(instances).set({ stripeCheckoutSessionId: session.id }).where(eq(instances.id, instance.id));
    await logEvent("billing.checkout_created", { userId: user.id, instanceId: instance.id, data: { sessionId: session.id, plan, coupon } });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return session.url;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    // The coupon ran out (or expired) between our check and the session: the offer is over.
    if (coupon && err instanceof Stripe.errors.StripeInvalidRequestError && (err.param?.startsWith("discounts") || /coupon/i.test(err.message))) {
      spotsCache = null;
      throw new BillingError(OFFER_ENDED);
    }
    // Details go to the audit log (/admin → Events); customers get a generic message.
    const message = stripeMessage(err);
    console.error(`[stripe] checkout for ${instance.slug} failed: ${message}`);
    await logEvent("billing.checkout_failed", { userId: user.id, instanceId: instance.id, data: { error: message } });
    throw new BillingError(`We couldn't start the checkout right now. Please try again in a few minutes or contact ${SUPPORT_EMAIL}.`);
  }
}

/** Current meaning of a stored checkout (see classifyCheckout); looks up the subscription of a completed one. */
async function checkoutOutcome(stripe: Stripe, session: Stripe.Checkout.Session, instance: Instance): Promise<CheckoutOutcome> {
  const subscriptionId = idOf(session.subscription);
  let subscriptionStatus: string | null = null;
  if (session.status === "complete" && subscriptionId && !isProcessedCheckout(session.status, subscriptionId, instance)) {
    subscriptionStatus =
      typeof session.subscription === "object" && session.subscription
        ? session.subscription.status
        : (await stripe.subscriptions.retrieve(subscriptionId)).status;
  }
  return classifyCheckout({ status: session.status, subscriptionId }, subscriptionStatus, instance);
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
 * Must run before a reservation is canceled, deleted or re-addressed: a checkout that was paid (and whose
 * subscription is alive) is processed (→ "paid", the caller must stop), an open one is expired so it can't be
 * paid later (→ "clear"). Paid checkouts whose subscription already died count as "clear".
 * Throws when Stripe can't be reached, so callers never drop a reservation they couldn't verify.
 */
export async function settleCheckoutSession(instance: Instance): Promise<"paid" | "clear"> {
  if (!instance.stripeCheckoutSessionId) return "clear";
  const { stripe } = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(instance.stripeCheckoutSessionId);
  const outcome = await checkoutOutcome(stripe, session, instance);
  if (outcome === "paid") {
    await processCheckoutSession(session, "settle");
    return "paid";
  }
  if (outcome === "open") await stripe.checkout.sessions.expire(session.id);
  return "clear";
}

/**
 * Housekeeping for an unpaid reservation: "keep" when its subscription is alive (it is synced, which starts
 * provisioning if the payment went through) or a checkout was just paid; otherwise "release" (open checkouts
 * are expired first). Throws when Stripe can't be reached.
 */
export async function settleReservation(instance: Instance): Promise<"keep" | "release"> {
  if (instance.stripeSubscriptionId) {
    const { stripe } = await stripeClient();
    const sub = await stripe.subscriptions.retrieve(instance.stripeSubscriptionId);
    if (isSubscriptionLive(sub.status)) {
      await applySubscription(stripe, instance, sub, "reservation");
      return "keep";
    }
  }
  return (await settleCheckoutSession(instance)) === "paid" ? "keep" : "release";
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
    const message = stripeMessage(err);
    console.error(`[stripe] billing portal for ${user.email} failed: ${message}`);
    await logEvent("billing.portal_failed", { userId: user.id, data: { error: message } });
    throw new BillingError(`We couldn't open the billing portal right now. Please try again in a few minutes or contact ${SUPPORT_EMAIL}.`);
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

/** A paid checkout that can't be matched to an instance must not keep billing every month. */
async function cancelOrphanSubscription(session: Stripe.Checkout.Session): Promise<boolean> {
  const subscriptionId = idOf(session.subscription);
  if (!subscriptionId) return false;
  try {
    const { stripe } = await stripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (isSubscriptionLive(sub.status)) await stripe.subscriptions.cancel(sub.id);
    return true;
  } catch (err) {
    console.error(`[stripe] could not cancel orphan subscription ${subscriptionId}`, err);
    return false;
  }
}

/** Plan interval + MRR for the instance row (growth report). Null when Stripe can't be read — never fails a sync. */
async function subscriptionBilling(stripe: Stripe, sub: Stripe.Subscription): Promise<ReturnType<typeof subscriptionMrr> | null> {
  try {
    const ref = sub.latest_invoice;
    const invoice = !ref ? null : typeof ref === "string" ? await stripe.invoices.retrieve(ref) : ref;
    return subscriptionMrr(sub, invoice);
  } catch (err) {
    console.error(`[stripe] could not read the latest invoice of ${sub.id}: ${stripeMessage(err)}`);
    return null;
  }
}

/**
 * Stores subscription state on the instance and starts/stops it accordingly (work runs after the response).
 * The write only succeeds if the instance is still in the state the decision was based on; otherwise (a racing
 * webhook + success redirect, a stop or a delete) it re-reads once and decides again, so an instance is never
 * started twice or brought back after a stop/delete.
 */
async function applySubscription(stripe: Stripe, initial: Instance, sub: Stripe.Subscription, source: string): Promise<void> {
  let instance = initial;
  let billing: Awaited<ReturnType<typeof subscriptionBilling>> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!shouldApplySubscription(instance, sub)) {
      await logEvent("stripe.subscription_ignored", {
        instanceId: instance.id,
        data: { subscriptionId: sub.id, status: sub.status, current: instance.stripeSubscriptionId, source },
      });
      await cancelDuplicateSubscription(stripe, instance, sub, source);
      return;
    }
    const transition = instanceTransition(instance.status, subscriptionAction(sub.status), {
      stoppedByAdmin: instance.stoppedByAdmin,
      complimentary: instance.complimentary,
    });
    billing ??= await subscriptionBilling(stripe, sub);
    const [written] = await db
      .update(instances)
      .set({
        stripeSubscriptionId: sub.id,
        ...(instance.stripeSubscriptionId !== sub.id ? { stripeCheckoutSessionId: null } : {}),
        subscriptionStatus: sub.status,
        currentPeriodEnd: periodEnd(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
        ...(billing ? { planInterval: billing.planInterval, mrrCents: billing.mrrCents } : {}),
        // Once a paid subscription attaches, a complimentary instance is billed like any other.
        complimentary: complimentaryAfterSubscription(instance.complimentary, sub.status),
        ...(transition === "provision" || transition === "start"
          ? { status: "provisioning" as const, error: null, startRequestedAt: null, provisionAttempts: 0, nextProvisionAt: null }
          : {}),
      })
      .where(and(eq(instances.id, instance.id), eq(instances.status, instance.status)))
      .returning({ id: instances.id });
    if (!written) {
      const fresh = await getInstance(instance.id);
      if (!fresh) return;
      instance = fresh;
      continue;
    }
    await afterSubscriptionApplied(instance, sub, transition, source);
    return;
  }
  await logEvent("billing.subscription_sync_conflict", { instanceId: instance.id, data: { subscriptionId: sub.id, status: sub.status, source } });
}

async function afterSubscriptionApplied(
  instance: Instance,
  sub: Stripe.Subscription,
  transition: ReturnType<typeof instanceTransition>,
  source: string,
) {
  const statusChanged = instance.subscriptionStatus !== sub.status || instance.stripeSubscriptionId !== sub.id;
  if (statusChanged) {
    await logEvent("billing.subscription_synced", {
      instanceId: instance.id,
      userId: instance.userId,
      data: { subscriptionId: sub.id, status: sub.status, transition, source },
    });
  }
  // Growth funnel: one event per subscription, the first time it is active (paid) — after checkout, a trial or a
  // failed first charge. Subscriptions that started before the funnel existed aren't new customers.
  if (sub.status === "active" && sub.start_date * 1000 >= ANALYTICS_START.getTime()) {
    await logEventOnce("billing.checkout_paid", "subscriptionId", {
      instanceId: instance.id,
      userId: instance.userId,
      data: { subscriptionId: sub.id, plan: sub.metadata?.plan ?? "monthly", offer: sub.metadata?.offer ?? null, source },
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
  // Older sessions carry no backend: they were dedicated instances.
  const backend = session.metadata?.backend === "shared" ? "shared" : "coolify";
  const address = backend === "shared" ? await resolveInstanceAddress({ backend }) : await resolveInstanceAddress({ backend, slug });
  if (!address.ok) return null;
  try {
    const [row] = await db
      .insert(instances)
      .values({
        id: instanceId,
        userId,
        backend,
        slug: address.slug,
        host: address.host,
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
  if (!isOwnCheckout(session)) {
    await logEvent("stripe.checkout_foreign", { data: { sessionId: session.id, source } });
    return null;
  }
  const instanceId = session.metadata?.instanceId;
  const existing = instanceId ? await getInstance(instanceId) : null;
  const instance = existing && existing.status !== "deleted" ? existing : await recreateReservation(session);
  if (!instance) {
    // Paid, but there is nothing to provision: stop future charges and leave the refund to an admin.
    const canceled = await cancelOrphanSubscription(session);
    console.error(`[stripe] paid checkout ${session.id} has no instance — subscription canceled: ${canceled}; refund it in Stripe`);
    await logEvent("stripe.checkout_unmatched", {
      userId: session.client_reference_id,
      data: { sessionId: session.id, subscription: idOf(session.subscription), canceled, source, action: "refund the payment in Stripe" },
    });
    return null;
  }
  if (instance.userId && session.client_reference_id && session.client_reference_id !== instance.userId) {
    const canceled = await cancelOrphanSubscription(session);
    await logEvent("stripe.checkout_owner_mismatch", {
      instanceId: instance.id,
      data: { sessionId: session.id, subscription: idOf(session.subscription), canceled, action: "refund the payment in Stripe" },
    });
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

/** Success redirect: fetch the session server-side and process it (only for its owner). Returns the session. */
export async function processCheckoutRedirect(sessionId: string, userId: string): Promise<Stripe.Checkout.Session | null> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  try {
    const { stripe } = await stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) return null;
    await processCheckoutSession(session, "redirect");
    return session;
  } catch (err) {
    console.error("[stripe] checkout redirect processing failed", err);
    return null;
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
  const mail = paymentFailedEmail({
    billingUrl: appUrl("/api/billing/portal"),
    subject: instance
      ? instance.backend === "shared"
        ? { kind: "workspace", label: instance.workspaceName }
        : { kind: "instance", label: instance.host }
      : null,
    amount,
  });
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
  // The endpoint may use an older API version than the SDK (see createWebhookEndpoint): only ids are taken from
  // the event, every object is re-read in the SDK's version.
  switch (event.type) {
    case "checkout.session.completed":
      await processCheckoutSession(await stripe.checkout.sessions.retrieve(event.data.object.id), "webhook");
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
      // Events can arrive out of order: always act on the current state from the API (canceled ones stay retrievable).
      const latest = await stripe.subscriptions.retrieve(sub.id);
      await applySubscription(stripe, instance, latest, event.type);
      break;
    }
    case "invoice.payment_failed":
      await handlePaymentFailed(stripe, await stripe.invoices.retrieve(event.data.object.id!));
      break;
    case "invoice.paid": {
      const invoice = await stripe.invoices.retrieve(event.data.object.id!);
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
      if (subscriptionId) await syncSubscriptionById(stripe, subscriptionId, "invoice.paid");
      break;
    }
    default:
      break;
  }
}
