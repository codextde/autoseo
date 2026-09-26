"use server";

import { z } from "zod";
import { addSearchHistory, getAhrefsDomainRatings, getBacklinksOverview, getBacklinksRows, getBacklinksTopPages, getReferringDomains } from "@/server/seo";
import { backlinksRowsInput, referringDomainsInput, topPagesInput } from "@/server/seo/backlinks";
import { seoAction } from "../server/action-helpers";

const viewInput = z.discriminatedUnion("tab", [
  z.object({ tab: z.literal("backlinks"), query: backlinksRowsInput }),
  z.object({ tab: z.literal("domains"), query: referringDomainsInput }),
  z.object({ tab: z.literal("pages"), query: topPagesInput }),
]);

/** Overview (summary + 1-year trends) + the active tab's page in one round trip. 6h cache; misses need `seo.run`. */
export async function getBacklinksViewAction(projectId: string, input: z.input<typeof viewInput>) {
  return seoAction(projectId, undefined, async (ctx) => {
    const v = viewInput.parse(input);
    const overviewPromise = getBacklinksOverview(ctx, { target: v.query.target, scope: v.query.scope });
    const tablePromise =
      v.tab === "backlinks"
        ? getBacklinksRows(ctx, v.query).then((r) => ({ kind: "backlinks" as const, ...r }))
        : v.tab === "domains"
          ? getReferringDomains(ctx, v.query).then((r) => ({ kind: "domains" as const, ...r }))
          : getBacklinksTopPages(ctx, v.query).then((r) => ({ kind: "pages" as const, ...r }));
    const [overview, table] = await Promise.allSettled([overviewPromise, tablePromise]);
    if (overview.status === "rejected") throw overview.reason;
    await addSearchHistory(ctx, "backlinks", overview.value.displayTarget, { target: v.query.target, scope: v.query.scope ?? null }).catch(() => undefined);
    return {
      overview: overview.value,
      table: table.status === "fulfilled" ? table.value : null,
      tableError: table.status === "rejected" ? (table.reason instanceof Error ? table.reason.message : String(table.reason)) : null,
    };
  });
}

/** One-per-domain row expansion: that domain's links (as_is, rank desc, 100). One billed request per expansion. */
export async function getBacklinksRowsAction(projectId: string, input: z.input<typeof backlinksRowsInput>) {
  return seoAction(projectId, undefined, (ctx) => getBacklinksRows(ctx, input));
}

export async function getReferringDomainsAction(projectId: string, input: z.input<typeof referringDomainsInput>) {
  return seoAction(projectId, undefined, (ctx) => getReferringDomains(ctx, input));
}

export async function getBacklinksTopPagesAction(projectId: string, input: z.input<typeof topPagesInput>) {
  return seoAction(projectId, undefined, (ctx) => getBacklinksTopPages(ctx, input));
}

/** Free Ahrefs DR (opt-in). Chunks of ≤100 domains. */
export async function getAhrefsDomainRatingsAction(projectId: string, domains: string[]) {
  return seoAction(projectId, undefined, () => getAhrefsDomainRatings(domains));
}
