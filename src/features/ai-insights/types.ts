import type { MetricKey, MetricValues } from "./lib/metrics";

/** Serializable brand descriptor (own brand has key "own"). */
export type BrandDTO = {
  key: string;
  competitorId: string | null;
  isOwn: boolean;
  name: string;
  domain: string | null;
  aliases: string[];
  color: string;
  tracked: boolean;
  source: "own" | "manual" | "auto" | "import";
};

export type FilterOptionsDTO = {
  engines: { value: string; label: string }[];
  tags: { value: string; label: string; color: string | null }[];
};

export type EngineShare = { engine: string; visibility: number; visible: number; answers: number };

export type RankingRow = {
  key: string;
  metrics: MetricValues;
  deltas: MetricValues;
  engines: EngineShare[];
};

export type BrandSuggestion = {
  name: string;
  answers: number;
  prompts: number;
  engines: string[];
  avgPosition: number | null;
  lastSeen: string;
  sample: string | null;
};

export type CompetitorsData = {
  brands: BrandDTO[];
  rows: RankingRow[];
  dates: string[];
  series: Record<string, Partial<Record<MetricKey, (number | null)[]>>>;
  byEngine: { keys: string[]; values: Record<string, Record<string, MetricValues>> };
  byTag: { keys: { id: string; name: string }[]; values: Record<string, Record<string, MetricValues>> };
  totals: { answers: number; prompts: number };
  suggestions: BrandSuggestion[];
};

export type AnswerRef = {
  answerId: string;
  promptId: string;
  promptText: string;
  engine: string;
  date: string;
};

export type AnswerDetail = {
  id: string;
  promptId: string;
  promptText: string;
  engine: string;
  model: string | null;
  country: string;
  date: string;
  text: string;
  brandMentioned: boolean;
  brandCited: boolean;
  brandPosition: number | null;
  sentiment: number | null;
  mentions: { name: string; isOwn: boolean; competitorId: string | null; position: number; sentiment: number | null; cited: boolean; recommended: boolean }[];
  citations: { url: string; domain: string; title: string | null; position: number; ownership: string; sourceId: string }[];
  statements: { brandName: string; polarity: string; attribute: string | null; quote: string }[];
};
