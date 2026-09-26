import type { Instance } from "@/server/db/schema";

/** Progress shown while an instance is being set up: Payment received → Creating → Starting → Ready. */
export const PROVISION_STEPS = ["Payment received", "Creating instance", "Starting", "Ready"] as const;

export type InstanceView = {
  id: string;
  slug: string;
  host: string;
  url: string;
  status: Instance["status"];
  /** Index into PROVISION_STEPS of the step currently in progress (4 = done). */
  step: number;
  workspaceName: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastHealthAt: string | null;
  healthy: boolean | null;
  /** Retry scheduled after a transient provisioning error. */
  retrying: boolean;
  /** Raw error details are for admins only; customers just learn that something went wrong. */
  hasError: boolean;
  error: string | null;
  createdAt: string;
};

export function provisionStep(i: Pick<Instance, "status" | "coolifyServiceUuid" | "startRequestedAt">): number {
  if (i.status === "running") return 4;
  if (i.status === "pending_payment") return 0;
  if (!i.coolifyServiceUuid) return 1;
  return i.startRequestedAt ? 2 : 1;
}

/** Client-safe projection (no secrets, no Coolify ids). */
export function toInstanceView(i: Instance, opts: { includeError?: boolean } = {}): InstanceView {
  return {
    id: i.id,
    slug: i.slug,
    host: i.host,
    url: `https://${i.host}`,
    status: i.status,
    step: provisionStep(i),
    workspaceName: i.workspaceName,
    subscriptionStatus: i.subscriptionStatus,
    currentPeriodEnd: i.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: i.cancelAtPeriodEnd,
    lastHealthAt: i.lastHealthAt?.toISOString() ?? null,
    healthy: i.lastHealthOk,
    retrying: i.status === "provisioning" && !!i.error && !!i.nextProvisionAt,
    hasError: !!i.error,
    error: opts.includeError ? i.error : null,
    createdAt: i.createdAt.toISOString(),
  };
}
