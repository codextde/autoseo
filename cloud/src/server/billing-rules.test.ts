import { describe, expect, it } from "vitest";
import {
  classifyCheckout,
  complimentaryAfterSubscription,
  instanceTransition,
  isOwnCheckout,
  isReleasableReservation,
  isProcessedCheckout,
  isSubscriptionLive,
  shouldApplySubscription,
  subscriptionAction,
} from "./billing-rules";

describe("subscriptionAction (webhook status → instance action)", () => {
  it.each([
    ["active", "run"],
    ["trialing", "run"],
    ["past_due", "run"],
    ["unpaid", "stop"],
    ["canceled", "stop"],
    ["incomplete_expired", "stop"],
    ["paused", "stop"],
    ["incomplete", "none"],
    [null, "none"],
    ["something_new", "none"],
  ] as const)("%s → %s", (status, action) => {
    expect(subscriptionAction(status)).toBe(action);
  });
});

describe("instanceTransition", () => {
  it("provisions a paid pending instance and restarts a stopped one", () => {
    expect(instanceTransition("pending_payment", "run")).toBe("provision");
    expect(instanceTransition("stopped", "run")).toBe("start");
  });

  it("leaves running / provisioning / failed instances alone while the subscription is fine", () => {
    expect(instanceTransition("running", "run")).toBe("none");
    expect(instanceTransition("provisioning", "run")).toBe("none");
    expect(instanceTransition("failed", "run")).toBe("none");
  });

  it("stops everything that is up when the subscription ends", () => {
    expect(instanceTransition("running", "stop")).toBe("stop");
    expect(instanceTransition("provisioning", "stop")).toBe("stop");
    expect(instanceTransition("failed", "stop")).toBe("stop");
    expect(instanceTransition("stopped", "stop")).toBe("none");
  });

  it("keeps an unpaid reservation pending so housekeeping can release the address", () => {
    expect(instanceTransition("pending_payment", "stop")).toBe("none");
  });

  it("doesn't restart an instance an admin stopped", () => {
    expect(instanceTransition("stopped", "run", { stoppedByAdmin: true })).toBe("none");
    expect(instanceTransition("stopped", "run", { stoppedByAdmin: false })).toBe("start");
  });

  it("never touches deleted instances and ignores 'none'", () => {
    expect(instanceTransition("deleted", "run")).toBe("none");
    expect(instanceTransition("deleted", "stop")).toBe("none");
    expect(instanceTransition("running", "none")).toBe("none");
  });
});

describe("shouldApplySubscription", () => {
  it("applies to instances without a subscription or with the same one", () => {
    expect(shouldApplySubscription({ stripeSubscriptionId: null, subscriptionStatus: null }, { id: "sub_1", status: "active" })).toBe(true);
    expect(shouldApplySubscription({ stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }, { id: "sub_1", status: "canceled" })).toBe(true);
  });

  it("lets a resubscription replace an ended subscription, but not the other way round", () => {
    expect(shouldApplySubscription({ stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" }, { id: "sub_new", status: "active" })).toBe(true);
    // A late "deleted" event of the old subscription must not stop the new one.
    expect(shouldApplySubscription({ stripeSubscriptionId: "sub_new", subscriptionStatus: "active" }, { id: "sub_old", status: "canceled" })).toBe(false);
    expect(shouldApplySubscription({ stripeSubscriptionId: "sub_a", subscriptionStatus: "active" }, { id: "sub_b", status: "active" })).toBe(false);
  });
});

describe("isSubscriptionLive", () => {
  it("treats everything except canceled / incomplete_expired as live", () => {
    expect(isSubscriptionLive("active")).toBe(true);
    expect(isSubscriptionLive("past_due")).toBe(true);
    expect(isSubscriptionLive("unpaid")).toBe(true);
    expect(isSubscriptionLive("canceled")).toBe(false);
    expect(isSubscriptionLive("incomplete_expired")).toBe(false);
    expect(isSubscriptionLive(null)).toBe(false);
  });
});

describe("isProcessedCheckout", () => {
  const stopped = { stripeSubscriptionId: "sub_old", status: "stopped" };
  it("treats the original checkout of an attached subscription as history (resubscribe can proceed)", () => {
    expect(isProcessedCheckout("complete", "sub_old", stopped)).toBe(true);
  });
  it("still treats a paid-but-unprocessed checkout as pending", () => {
    expect(isProcessedCheckout("complete", "sub_new", stopped)).toBe(false);
    expect(isProcessedCheckout("complete", "sub_old", { ...stopped, status: "pending_payment" })).toBe(false);
    expect(isProcessedCheckout("open", null, stopped)).toBe(false);
  });
});

describe("classifyCheckout", () => {
  const pending = { stripeSubscriptionId: null, status: "pending_payment" };
  it("keeps open sessions payable until they are expired", () => {
    expect(classifyCheckout({ status: "open", subscriptionId: null }, null, pending)).toBe("open");
  });
  it("treats a completed checkout with a live subscription as paid", () => {
    expect(classifyCheckout({ status: "complete", subscriptionId: "sub_1" }, "active", pending)).toBe("paid");
    expect(classifyCheckout({ status: "complete", subscriptionId: "sub_1" }, "incomplete", pending)).toBe("paid");
  });
  it("releases reservations whose paid checkout's subscription died", () => {
    expect(classifyCheckout({ status: "complete", subscriptionId: "sub_1" }, "incomplete_expired", pending)).toBe("clear");
    expect(classifyCheckout({ status: "complete", subscriptionId: "sub_1" }, "canceled", pending)).toBe("clear");
  });
  it("treats expired sessions and processed history as clear", () => {
    expect(classifyCheckout({ status: "expired", subscriptionId: null }, null, pending)).toBe("clear");
    expect(
      classifyCheckout({ status: "complete", subscriptionId: "sub_old" }, "canceled", { stripeSubscriptionId: "sub_old", status: "stopped" }),
    ).toBe("clear");
  });
});

describe("complimentary instances", () => {
  it("are never stopped by billing events", () => {
    expect(instanceTransition("running", "stop", { complimentary: true })).toBe("none");
    expect(instanceTransition("provisioning", "stop", { complimentary: true })).toBe("none");
    expect(instanceTransition("failed", "stop", { complimentary: true })).toBe("none");
    // A paid subscription can still start a stopped one.
    expect(instanceTransition("stopped", "run", { complimentary: true })).toBe("start");
  });

  it("stop being complimentary once a paid subscription attaches", () => {
    expect(complimentaryAfterSubscription(true, "active")).toBe(false);
    expect(complimentaryAfterSubscription(true, "trialing")).toBe(false);
    expect(complimentaryAfterSubscription(true, "incomplete")).toBe(true);
    expect(complimentaryAfterSubscription(true, "incomplete_expired")).toBe(true);
    expect(complimentaryAfterSubscription(false, "active")).toBe(false);
  });

  it("are ignored by reservation release", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const old = new Date(now - 49 * 3600_000);
    const ttl = 48 * 3600_000;
    expect(isReleasableReservation({ status: "pending_payment", complimentary: false, createdAt: old }, now, ttl)).toBe(true);
    expect(isReleasableReservation({ status: "pending_payment", complimentary: true, createdAt: old }, now, ttl)).toBe(false);
    expect(isReleasableReservation({ status: "pending_payment", complimentary: false, createdAt: new Date(now - 47 * 3600_000) }, now, ttl)).toBe(false);
    expect(isReleasableReservation({ status: "running", complimentary: false, createdAt: old }, now, ttl)).toBe(false);
  });
});

describe("isOwnCheckout (shared Stripe account)", () => {
  it("accepts checkouts created by AutoSEO Cloud", () => {
    expect(isOwnCheckout({ metadata: { instanceId: "i1", userId: "u1", slug: "acme" } })).toBe(true);
  });
  it.each([
    ["another product's checkout", { metadata: { plan: "monthly", license_key: "GM-XXXX" } }],
    ["no metadata", { metadata: null }],
    ["instance without user", { metadata: { instanceId: "i1" } }],
  ])("ignores %s", (_, session) => {
    expect(isOwnCheckout(session)).toBe(false);
  });
});
