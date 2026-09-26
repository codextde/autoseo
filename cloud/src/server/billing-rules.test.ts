import { describe, expect, it } from "vitest";
import { instanceTransition, isSubscriptionLive, shouldApplySubscription, subscriptionAction } from "./billing-rules";

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
    expect(instanceTransition("pending_payment", "stop")).toBe("stop");
    expect(instanceTransition("stopped", "stop")).toBe("none");
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
