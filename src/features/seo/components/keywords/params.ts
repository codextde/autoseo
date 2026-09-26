"use client";

import {
  EMPTY_KEYWORD_FILTERS,
  KEYWORD_INTENTS,
  type KeywordFilterValues,
  type KeywordMode,
  type KeywordSortField,
  type ResultLimit,
} from "@/server/seo/lib/keywords";

export const MODES: { value: KeywordMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "related", label: "Related keywords" },
  { value: "suggestions", label: "Suggestions" },
  { value: "ideas", label: "Ideas" },
];

export const PAGE_SIZES = [50, 100, 300, 500] as const;
export const SORT_FIELDS: KeywordSortField[] = ["keyword", "searchVolume", "cpc", "competition", "keywordDifficulty"];
export const FILTER_KEYS = Object.keys(EMPTY_KEYWORD_FILTERS) as (keyof KeywordFilterValues)[];

/** One search = one tab (open-seo `KeywordSearchTabInput`). */
export type KeywordSearchInput = { keyword: string; loc: number; kLimit: ResultLimit; mode: KeywordMode; cs: boolean };

export type KeywordUrlState = KeywordSearchInput & {
  sort: KeywordSortField;
  order: "asc" | "desc";
  kw: string | null;
  page: number;
  size: (typeof PAGE_SIZES)[number];
  filters: KeywordFilterValues;
};

function int(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readUrlState(params: URLSearchParams, defaultLoc: number): KeywordUrlState {
  const kLimitRaw = int(params.get("kLimit"));
  const modeRaw = params.get("mode");
  const sortRaw = params.get("sort");
  const sizeRaw = int(params.get("size"));
  const filters = { ...EMPTY_KEYWORD_FILTERS };
  for (const k of FILTER_KEYS) filters[k] = params.get(k) ?? "";
  // Intents are stored in canonical order and validated.
  filters.intents = KEYWORD_INTENTS.filter((i) => filters.intents.split(",").includes(i)).join(",");
  return {
    keyword: (params.get("q") ?? "").trim().toLowerCase(),
    loc: int(params.get("loc")) ?? defaultLoc,
    kLimit: kLimitRaw === 300 || kLimitRaw === 500 ? kLimitRaw : 150,
    mode: modeRaw === "related" || modeRaw === "suggestions" || modeRaw === "ideas" ? modeRaw : "auto",
    cs: params.get("cs") === "1" || params.get("cs") === "true",
    sort: SORT_FIELDS.includes(sortRaw as KeywordSortField) ? (sortRaw as KeywordSortField) : "searchVolume",
    order: params.get("order") === "asc" ? "asc" : "desc",
    kw: params.get("kw"),
    page: int(params.get("page")) ?? 1,
    size: PAGE_SIZES.includes(sizeRaw as (typeof PAGE_SIZES)[number]) ? (sizeRaw as (typeof PAGE_SIZES)[number]) : 50,
    filters,
  };
}

/** URL patch for a search input — defaults (project location, 150, auto, no clickstream) are omitted. */
export function searchPatch(input: KeywordSearchInput, defaultLoc: number) {
  return {
    q: input.keyword,
    loc: input.loc === defaultLoc ? null : input.loc,
    kLimit: input.kLimit === 150 ? null : input.kLimit,
    mode: input.mode === "auto" ? null : input.mode,
    cs: input.cs ? "1" : null,
    kw: null,
    page: null,
  };
}

export function researchKey(projectId: string, input: KeywordSearchInput) {
  return `kw-research:${projectId}:${JSON.stringify([input.keyword, input.loc, input.kLimit, input.mode, input.cs])}`;
}

export function serpKey(projectId: string, keyword: string, loc: number, depth: 20 | 100) {
  return `kw-serp:${projectId}:${loc}:${depth}:${keyword}`;
}

export function sameInput(a: KeywordSearchInput, b: KeywordSearchInput) {
  return a.keyword === b.keyword && a.loc === b.loc && a.kLimit === b.kLimit && a.mode === b.mode && a.cs === b.cs;
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
