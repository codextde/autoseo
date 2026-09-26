"use client";

import {
  BACKLINKS_PAGE_SIZES,
  BACKLINKS_ROWS_SORT_FIELDS,
  DEFAULT_BACKLINKS_SORT,
  REFERRING_DOMAINS_SORT_FIELDS,
  resolveBacklinksScope,
  TOP_PAGES_SORT_FIELDS,
  type BacklinksRowsFilters,
  type BacklinksTab,
  type ReferringDomainsFilters,
  type SortOrder,
  type TopPagesFilters,
} from "@/server/seo/lib/backlinks";
import { defaultScopeForInput, isScopeAllowedForInput, parseResearchTarget, type ResearchScope } from "@/server/seo/lib/research-scope";
import { numOrUndefined, termCount } from "../domain/storage";

export const TAB_FILTER_KEYS: Record<BacklinksTab, readonly string[]> = {
  backlinks: ["include", "exclude", "minDomainRank", "maxDomainRank", "minLinkAuthority", "maxLinkAuthority", "minSpamScore", "maxSpamScore", "linkType", "hideLost", "hideBroken"],
  domains: ["include", "exclude", "minBacklinks", "maxBacklinks", "minRank", "maxRank", "minSpamScore", "maxSpamScore"],
  pages: ["include", "exclude", "minBacklinks", "maxBacklinks", "minReferringDomains", "maxReferringDomains", "minRank", "maxRank"],
};
export const ALL_BACKLINK_FILTER_KEYS = [...new Set(Object.values(TAB_FILTER_KEYS).flat())];

export const SORT_FIELDS: Record<BacklinksTab, readonly string[]> = {
  backlinks: Object.keys(BACKLINKS_ROWS_SORT_FIELDS),
  domains: Object.keys(REFERRING_DOMAINS_SORT_FIELDS),
  pages: Object.keys(TOP_PAGES_SORT_FIELDS),
};

export type BacklinksUrlState = {
  target: string;
  targetError: string | null;
  scope: ResearchScope;
  scopeExplicit: boolean;
  tab: BacklinksTab;
  page: number;
  size: (typeof BACKLINKS_PAGE_SIZES)[number];
  sort: string;
  order: SortOrder;
  allLinks: boolean;
  hideSpam: boolean;
  filters: Record<string, string>;
};

/** `backlinksSearchSchema` from the URL; legacy scope `page` = exact_url; domains tab forced to backlinks for subfolder. */
export function parseBacklinksParams(params: URLSearchParams): BacklinksUrlState {
  const target = (params.get("target") ?? "").trim();
  let explicit = resolveBacklinksScope(params.get("scope") ?? undefined);
  let targetError: string | null = null;
  if (target) {
    const base = parseResearchTarget(target);
    if (base.ok && explicit && !isScopeAllowedForInput(explicit, base.target.path)) explicit = undefined;
    const parsed = parseResearchTarget(target, explicit);
    if (!parsed.ok) targetError = parsed.message;
  }
  const scope = explicit ?? defaultScopeForInput(target);
  const rawTab = params.get("tab");
  let tab: BacklinksTab = rawTab === "domains" || rawTab === "pages" ? rawTab : "backlinks";
  if (scope === "subfolder" && tab === "domains") tab = "backlinks";
  const rawSort = params.get("sort");
  const sortValid = rawSort != null && SORT_FIELDS[tab].includes(rawSort);
  const sort = sortValid ? rawSort : DEFAULT_BACKLINKS_SORT[tab].sort;
  const rawOrder = params.get("order");
  const order: SortOrder = rawOrder === "asc" || rawOrder === "desc" ? rawOrder : sortValid ? "desc" : DEFAULT_BACKLINKS_SORT[tab].order;
  const sizeRaw = Number(params.get("size"));
  const size = (BACKLINKS_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? (sizeRaw as BacklinksUrlState["size"]) : 100;
  return {
    target,
    targetError,
    scope,
    scopeExplicit: explicit != null,
    tab,
    page: Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    size,
    sort,
    order,
    allLinks: params.get("view") === "all",
    hideSpam: params.get("spam") === "1",
    filters: Object.fromEntries(TAB_FILTER_KEYS[tab].map((k) => [k, params.get(k) ?? ""])),
  };
}

const bool = (v: string | undefined) => v === "1" || v === "true";
const text = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function toRowsFilters(v: Record<string, string>): BacklinksRowsFilters {
  return {
    include: text(v.include),
    exclude: text(v.exclude),
    minDomainRank: numOrUndefined(v.minDomainRank),
    maxDomainRank: numOrUndefined(v.maxDomainRank),
    minLinkAuthority: numOrUndefined(v.minLinkAuthority),
    maxLinkAuthority: numOrUndefined(v.maxLinkAuthority),
    minSpamScore: numOrUndefined(v.minSpamScore),
    maxSpamScore: numOrUndefined(v.maxSpamScore),
    linkType: v.linkType === "dofollow" || v.linkType === "nofollow" ? v.linkType : undefined,
    hideLost: bool(v.hideLost) || undefined,
    hideBroken: bool(v.hideBroken) || undefined,
  };
}

export function toDomainsFilters(v: Record<string, string>): ReferringDomainsFilters {
  return {
    include: text(v.include),
    exclude: text(v.exclude),
    minBacklinks: numOrUndefined(v.minBacklinks),
    maxBacklinks: numOrUndefined(v.maxBacklinks),
    minRank: numOrUndefined(v.minRank),
    maxRank: numOrUndefined(v.maxRank),
    minSpamScore: numOrUndefined(v.minSpamScore),
    maxSpamScore: numOrUndefined(v.maxSpamScore),
  };
}

export function toPagesFilters(v: Record<string, string>): TopPagesFilters {
  return {
    include: text(v.include),
    exclude: text(v.exclude),
    minBacklinks: numOrUndefined(v.minBacklinks),
    maxBacklinks: numOrUndefined(v.maxBacklinks),
    minReferringDomains: numOrUndefined(v.minReferringDomains),
    maxReferringDomains: numOrUndefined(v.maxReferringDomains),
    minRank: numOrUndefined(v.minRank),
    maxRank: numOrUndefined(v.maxRank),
  };
}

/** User filter conditions as the server counts them (each term / bound / flag = 1). */
export function countBacklinkConditions(v: Record<string, string>): number {
  let n = termCount(v.include) + termCount(v.exclude);
  for (const [k, value] of Object.entries(v)) {
    if (k === "include" || k === "exclude") continue;
    if (k === "linkType") n += value === "dofollow" || value === "nofollow" ? 1 : 0;
    else if (k === "hideLost" || k === "hideBroken") n += bool(value) ? 1 : 0;
    else if (numOrUndefined(value) != null) n += 1;
  }
  return n;
}

export const filtersStorageKey = (tab: BacklinksTab) => `backlinks-filters:${tab}`;

/** Parses DataForSEO timestamps ("2019-03-05 21:21:01 +00:00") safely across browsers. */
export function parseDfsDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) ? value.replace(" ", "T").replace(" ", "") : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDfsDate(value: string | null | undefined): string {
  const d = parseDfsDate(value);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function stripWww(domain: string | null | undefined): string {
  return (domain ?? "").toLowerCase().replace(/^www\./, "");
}
