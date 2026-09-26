"use server";

import { z } from "zod";
import { addSearchHistory, getDomainKeywordsPage, getDomainOverview, getDomainPagesPage } from "@/server/seo";
import { domainKeywordsPageInput, domainPagesPageInput } from "@/server/seo/domain";
import { seoAction } from "../server/action-helpers";

const viewInput = z.object({
  tab: z.enum(["keywords", "pages"]).default("keywords"),
  keywords: domainKeywordsPageInput,
  pages: domainPagesPageInput,
});

/**
 * Domain Overview view in one round trip (server actions run sequentially per client): overview stat cards +
 * the active tab's page, fetched in parallel. Both are 12h-cached; a cache miss requires `seo.run`.
 */
export async function getDomainViewAction(projectId: string, input: z.input<typeof viewInput>) {
  return seoAction(projectId, undefined, async (ctx) => {
    const v = viewInput.parse(input);
    const base = { domain: v.keywords.domain, scope: v.keywords.scope, locationCode: v.keywords.locationCode, languageCode: v.keywords.languageCode };
    const [overview, table] = await Promise.all([
      getDomainOverview(ctx, base),
      v.tab === "keywords"
        ? getDomainKeywordsPage(ctx, v.keywords).then((r) => ({ kind: "keywords" as const, ...r }))
        : getDomainPagesPage(ctx, v.pages).then((r) => ({ kind: "pages" as const, ...r })),
    ]);
    if (overview.hasData) {
      await addSearchHistory(ctx, "domain", overview.displayTarget, {
        domain: overview.displayTarget,
        scope: overview.scope,
        sort: v.keywords.sortMode,
        tab: v.tab,
        loc: overview.locationCode,
      }).catch(() => undefined);
    }
    return { overview, table };
  });
}

/** All rows for "export all" are the currently loaded page (DataForSEO paging is billed per page). */
export async function getDomainKeywordsPageAction(projectId: string, input: z.input<typeof domainKeywordsPageInput>) {
  return seoAction(projectId, undefined, (ctx) => getDomainKeywordsPage(ctx, input));
}

export async function getDomainPagesPageAction(projectId: string, input: z.input<typeof domainPagesPageInput>) {
  return seoAction(projectId, undefined, (ctx) => getDomainPagesPage(ctx, input));
}
