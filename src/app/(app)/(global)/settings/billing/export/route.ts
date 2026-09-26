import { getUserContext } from "@/server/auth/context";
import { getSetting } from "@/server/settings";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";
import { getMonthlyHistory, resolveBillingScope } from "@/server/admin/billing";
import { csvCell } from "@/features/settings/billing/math";
import { providerLabel } from "@/features/settings/usage/labels";

/** CSV of the monthly statements (same access rules as /settings/billing). */
export async function GET(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const bs = await resolveBillingScope(ctx, { ws: url.searchParams.get("ws"), scope: url.searchParams.get("scope") });
  if (!bs) return new Response("Forbidden", { status: 403 });
  if (!rateLimit(`billing-export:${ctx.user.id}`, 30, 60 * 60_000)) return new Response("Too many exports", { status: 429 });

  const [rows, limits] = await Promise.all([getMonthlyHistory(bs.scope, 12), getSetting("limits")]);
  const providers = [...new Set(rows.flatMap((r) => Object.keys(r.providers)))].sort();
  const withBudget = bs.scopeKind === "instance" && bs.isAdmin && limits.monthlyBudgetUsd > 0;

  const header = ["month", "calls", ...providers.map((p) => `${providerLabel(p)} (USD)`), "total_usd"];
  if (withBudget) header.push("budget_usd", "over_under_usd");
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const cells: unknown[] = [r.month, r.events, ...providers.map((p) => Number((r.providers[p] ?? 0).toFixed(6))), Number(r.cost.toFixed(6))];
    if (withBudget) cells.push(limits.monthlyBudgetUsd, Number((r.cost - limits.monthlyBudgetUsd).toFixed(6)));
    lines.push(cells.map(csvCell).join(","));
  }
  void logAudit("billing.exported", {
    actor: { id: ctx.user.id, email: ctx.user.email },
    workspaceId: bs.scopeKind === "workspace" ? bs.workspaceId : null,
    meta: { scope: bs.scopeKind },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="billing-statements-${bs.scopeKind}-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
