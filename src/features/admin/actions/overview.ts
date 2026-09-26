"use server";

import { actionAdmin, runAction } from "@/server/auth/guards";
import { runHealthChecks } from "@/server/admin/overview";

export async function runHealthChecksAction(force = false) {
  return runAction(async () => {
    await actionAdmin();
    return runHealthChecks(Boolean(force));
  });
}
