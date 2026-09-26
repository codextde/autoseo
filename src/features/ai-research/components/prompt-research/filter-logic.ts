import type { ResearchItem } from "../../types";

export type FilterKey = "topics" | "len" | "funnel" | "brand" | "personas";
export type Filters = Record<FilterKey, string[]> & { q: string };

export const NO_TOPIC = "__none";
export const NO_PERSONA = "__none";

export function topicKey(i: ResearchItem) {
  return i.topic?.trim() || NO_TOPIC;
}

function matches(i: ResearchItem, f: Filters, skip?: FilterKey): boolean {
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!i.text.toLowerCase().includes(q) && !(i.topic ?? "").toLowerCase().includes(q) && !(i.keyword ?? "").toLowerCase().includes(q)) return false;
  }
  if (skip !== "topics" && f.topics.length && !f.topics.includes(topicKey(i))) return false;
  if (skip !== "len" && f.len.length && !(i.length && f.len.includes(i.length))) return false;
  if (skip !== "funnel" && f.funnel.length && !(i.funnelStage && f.funnel.includes(i.funnelStage))) return false;
  if (skip !== "personas" && f.personas.length && !f.personas.includes(i.persona?.trim() || NO_PERSONA)) return false;
  if (skip !== "brand" && f.brand.length) {
    const ok =
      (f.brand.includes("branded") && i.branded) ||
      (f.brand.includes("nonbranded") && !i.branded) ||
      (f.brand.includes("competitor") && !!i.competitorMentioned) ||
      (f.brand.includes("tracked") && !!i.trackedPromptId) ||
      (f.brand.includes("untracked") && !i.trackedPromptId);
    if (!ok) return false;
  }
  return true;
}

export function applyFilters(items: ResearchItem[], f: Filters, skip?: FilterKey): ResearchItem[] {
  return items.filter((i) => matches(i, f, skip));
}

/** Faceted counts: each group counts items matching all *other* active filters. */
export function facetCounts(items: ResearchItem[], f: Filters) {
  const count = (key: FilterKey, get: (i: ResearchItem) => string[]) => {
    const map = new Map<string, number>();
    for (const i of applyFilters(items, f, key)) for (const v of get(i)) map.set(v, (map.get(v) ?? 0) + 1);
    return map;
  };
  return {
    topics: count("topics", (i) => [topicKey(i)]),
    len: count("len", (i) => (i.length ? [i.length] : [])),
    funnel: count("funnel", (i) => (i.funnelStage ? [i.funnelStage] : [])),
    brand: count("brand", (i) => [
      i.branded ? "branded" : "nonbranded",
      ...(i.competitorMentioned ? ["competitor"] : []),
      i.trackedPromptId ? "tracked" : "untracked",
    ]),
    personas: count("personas", (i) => [i.persona?.trim() || NO_PERSONA]),
  };
}

export function activeFilterCount(f: Filters) {
  return f.topics.length + f.len.length + f.funnel.length + f.brand.length + f.personas.length;
}
