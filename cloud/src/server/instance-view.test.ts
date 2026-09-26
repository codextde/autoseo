import { describe, expect, it } from "vitest";
import { provisionStep, PROVISION_STEPS } from "./instance-view";

describe("provisionStep", () => {
  it("walks Payment received → Creating instance → Starting → Ready", () => {
    expect(PROVISION_STEPS).toEqual(["Payment received", "Creating instance", "Starting", "Ready"]);
    expect(provisionStep({ status: "pending_payment", coolifyServiceUuid: null, startRequestedAt: null })).toBe(0);
    expect(provisionStep({ status: "provisioning", coolifyServiceUuid: null, startRequestedAt: null })).toBe(1);
    expect(provisionStep({ status: "provisioning", coolifyServiceUuid: "svc", startRequestedAt: null })).toBe(1);
    expect(provisionStep({ status: "provisioning", coolifyServiceUuid: "svc", startRequestedAt: new Date() })).toBe(2);
    expect(provisionStep({ status: "running", coolifyServiceUuid: "svc", startRequestedAt: null })).toBe(4);
  });
});
