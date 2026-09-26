/** Isomorphic view-model types for the Fact Check pages. */

export type FcMarketView = { country: string; regulator: string };

export type VerdictCounts = {
  collected: number;
  pending: number;
  checked: number;
  matched: number;
  needs_review: number;
  off_label: number;
  contradicted: number;
  unsupported: number;
  outdated: number;
};

export type RunState = {
  active: { id: string; status: string; type: string } | null;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    stats: Record<string, unknown>;
    error: string | null;
  } | null;
};

export type AssetRow = {
  id: string;
  name: string;
  aliases: string[];
  activeIngredient: string | null;
  markets: FcMarketView[];
  status: "active" | "paused";
  docs: number;
  docsReady: number;
  docsFailed: number;
  openFindings: number;
  criticalFindings: number;
  counts: VerdictCounts;
  lastCheckedAt: string | null;
};

export type OverviewData = {
  totals: VerdictCounts;
  assets: AssetRow[];
  lastCheckedAt: string | null;
  answersTracked: number;
  aiReady: boolean;
  run: RunState;
};

export type FindingVerdict = "off_label" | "contradicted" | "unsupported" | "outdated" | "needs_review";

export type FindingRow = {
  id: string;
  assetId: string;
  assetName: string;
  claim: string;
  verdict: FindingVerdict;
  severity: "critical" | "major" | "minor" | null;
  engine: string;
  market: string;
  labelSection: string | null;
  labelQuote: string | null;
  answerQuote: string | null;
  explanation: string | null;
  judgedBy: "ai" | "lexical" | "user" | null;
  matchScore: number | null;
  status: "open" | "resolved" | "ignored";
  seenCount: number;
  promptId: string | null;
  promptText: string | null;
  answerId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type FindingsFilters = {
  markets: string[];
  engines: string[];
  types: string[];
  severities: string[];
  assets: string[];
  status: "open" | "resolved" | "ignored" | "all";
  period: string;
  tab: "all" | "off_label";
};

export type FindingsData = {
  rows: FindingRow[];
  kpis: { open: number; critical: number; major: number; minor: number; needsReview: number };
  backlog: { date: string; open: number; critical: number }[];
  offLabelCount: number;
  options: { markets: string[]; engines: string[]; assets: { id: string; name: string }[] };
  total: number;
};

export type AccuracyGroup = { key: string; counts: VerdictCounts; matchRate: number | null };

export type AccuracyData = {
  period: string;
  total: VerdictCounts;
  matchRate: number | null;
  trend: { date: string; matchRate: number; deviationRate: number; checked: number }[];
  byEngine: AccuracyGroup[];
  byMarket: AccuracyGroup[];
  byAsset: { id: string; name: string; counts: VerdictCounts; matchRate: number | null; openFindings: number }[];
};

export type DocumentView = {
  id: string;
  title: string;
  kind: "pdf" | "text" | "url";
  sourceUrl: string | null;
  fileName: string | null;
  market: string | null;
  version: string | null;
  effectiveDate: string | null;
  superseded: boolean;
  charCount: number;
  sections: { id: string; heading: string }[];
  status: "processing" | "ready" | "failed";
  error: string | null;
  createdAt: string;
};

export type StatementView = {
  id: string;
  claim: string;
  verdict: string;
  severity: "critical" | "major" | "minor" | null;
  engine: string;
  market: string;
  labelSection: string | null;
  labelQuote: string | null;
  answerQuote: string | null;
  explanation: string | null;
  status: "open" | "resolved" | "ignored";
  seenCount: number;
  lastSeenAt: string;
  judgedBy: "ai" | "lexical" | "user" | null;
};

export type AssetDetail = {
  asset: {
    id: string;
    name: string;
    aliases: string[];
    activeIngredient: string | null;
    description: string | null;
    markets: FcMarketView[];
    status: "active" | "paused";
    sourceUrl: string | null;
    lastCheckedAt: string | null;
    createdAt: string;
  };
  documents: DocumentView[];
  statements: StatementView[];
  counts: VerdictCounts;
  deviations: number;
};

export type AssetCandidateView = {
  name: string;
  aliases: string[];
  activeIngredient: string | null;
  source: "structured_data" | "heading" | "ai";
};

export type DiscoverResult = {
  url: string;
  title: string;
  kind: "pdf" | "html";
  chars: number;
  usedAi: boolean;
  aiError: string | null;
  candidates: AssetCandidateView[];
};
