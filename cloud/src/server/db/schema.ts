import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Prefixed random ids like `ins_4f9k2m…` (16 chars, ~82 bits). */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

const id = (prefix: string) =>
  text()
    .primaryKey()
    .$defaultFn(() => newId(prefix));
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () =>
  ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const INSTANCE_STATUSES = ["pending_payment", "provisioning", "running", "stopped", "failed", "deleted"] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const users = pgTable(
  "users",
  {
    id: id("usr"),
    email: text().notNull(),
    name: text(),
    /** Mirrors ADMIN_EMAILS (re-synced on every sign-in / session lookup). */
    isAdmin: boolean().notNull().default(false),
    stripeCustomerId: text(),
    createdAt: createdAt(),
    lastLoginAt: ts(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_stripe_customer_idx").on(t.stripeCustomerId)],
);

/** One row per signed-in device. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id("ses"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull(),
    ip: text(),
    userAgent: text(),
    expiresAt: ts().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Magic-link + one-time-code sign-in attempts (hashes only, single use, short-lived). */
export const loginTokens = pgTable(
  "login_tokens",
  {
    id: id("lgt"),
    email: text().notNull(),
    tokenHash: text().notNull(),
    codeHash: text().notNull(),
    redirectTo: text(),
    requestIp: text(),
    attempts: integer().notNull().default(0),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("login_tokens_hash_uq").on(t.tokenHash), index("login_tokens_email_idx").on(t.email)],
);

/** One managed AutoSEO deployment (a Coolify service) per customer subscription. */
export const instances = pgTable(
  "instances",
  {
    id: id("ins"),
    userId: text().references(() => users.id, { onDelete: "set null" }),
    slug: text().notNull(),
    /** Public host, fixed when the instance is created (e.g. acme.autoseo.codext.de). */
    host: text().notNull(),
    status: text({ enum: INSTANCE_STATUSES }).notNull().default("pending_payment"),
    workspaceName: text().notNull(),
    coolifyServiceUuid: text(),
    stripeCheckoutSessionId: text(),
    stripeSubscriptionId: text(),
    subscriptionStatus: text(),
    currentPeriodEnd: ts(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    /** AUTOSEO_SSO_SECRET of this instance, encrypted with the master key. */
    ssoSecretEnc: text(),
    /** Set once the service start was requested; the reconciler then waits for /api/health. */
    startRequestedAt: ts(),
    provisionAttempts: integer().notNull().default(0),
    nextProvisionAt: ts(),
    lastHealthAt: ts(),
    lastHealthOk: boolean(),
    readyEmailSentAt: ts(),
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Deleted instances release their address.
    uniqueIndex("instances_slug_live_uq").on(t.slug).where(sql`status <> 'deleted'`),
    index("instances_user_idx").on(t.userId),
    index("instances_subscription_idx").on(t.stripeSubscriptionId),
    index("instances_status_idx").on(t.status),
  ],
);

/** Integration settings, one encrypted JSON document per key. */
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  valueEnc: text().notNull(),
  updatedAt: updatedAt(),
});

/** Audit log of everything that happens to accounts, billing and instances. */
export const events = pgTable(
  "events",
  {
    id: id("evt"),
    type: text().notNull(),
    userId: text(),
    instanceId: text(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_created_idx").on(t.createdAt), index("events_instance_idx").on(t.instanceId)],
);

/** Processed Stripe webhook event ids (idempotency). */
export const stripeEvents = pgTable("stripe_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Instance = typeof instances.$inferSelect;
export type EventRow = typeof events.$inferSelect;
