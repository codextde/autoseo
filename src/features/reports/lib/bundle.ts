/**
 * The live data bundle for one project + period. Produced server-side by
 * `src/server/reports/data.ts` and consumed (isomorphically) by the token / chart / list resolvers.
 * Share links in snapshot mode store a frozen copy of this object.
 */

export type Kpis = {
  /** % of answers naming OR citing the brand */
  visibility: number | null;
  /** % of answers naming the brand */
  mentionRate: number | null;
  /** % of answers citing an own domain */
  citationRate: number | null;
  /** mean ordinal position among brands named (1 = first) */
  avgPosition: number | null;
  /** mean own-brand sentiment 0–100 */
  sentiment: number | null;
  /** own brand mentions ÷ all brand mentions (%) */
  shareOfVoice: number | null;
  /** composite 0–100 GEO score */
  geoScore: number | null;
};

export type TrendPoint = {
  date: string;
  answers: number;
  visibility: number | null;
  mentionRate: number | null;
  citationRate: number | null;
  sentiment: number | null;
  position: number | null;
};

export type BrandRow = {
  key: string;
  name: string;
  domain: string | null;
  isOwn: boolean;
  color: string | null;
  /** answers naming or citing the brand */
  visibleAnswers: number;
  mentions: number;
  citedAnswers: number;
  visibility: number | null;
  prevVisibility: number | null;
  mentionRate: number | null;
  avgPosition: number | null;
  sentiment: number | null;
  shareOfVoice: number | null;
};

export type BrandTrend = {
  brands: { key: string; name: string; isOwn: boolean }[];
  rows: { date: string; values: Record<string, number | null> }[];
};

export type EngineRow = {
  engine: string;
  label: string;
  answers: number;
  visibility: number | null;
  mentionRate: number | null;
  citationRate: number | null;
};

export type SourceRow = {
  domain: string;
  title: string | null;
  citations: number;
  prompts: number;
  contentType: string;
  ownership: "own" | "competitor" | "third_party";
};

export type PageRow = { url: string; title: string | null; citations: number };

export type PromptRow = {
  id: string;
  text: string;
  topic: string | null;
  funnelStage: string | null;
  answers: number;
  visibility: number | null;
  prevVisibility: number | null;
  mentionRate: number | null;
  citationRate: number | null;
  category: "mentioned_cited" | "mentioned" | "cited" | "none" | "no_data";
};

export type StatementRow = { quote: string; theme: string | null; attribute: string | null; brand: string };

export type TaskRow = {
  title: string;
  category: string;
  priority: number;
  impact: number;
  effort: number;
  status: string;
};

export type DataBundle = {
  version: 1;
  generatedAt: string;
  project: {
    id: string;
    name: string;
    domain: string;
    country: string;
    clientName: string;
    /** "asset:<id>" or an http(s) URL */
    clientLogo: string | null;
    clientColor: string | null;
  };
  agency: {
    name: string;
    logo: string | null;
    website: string | null;
    email: string | null;
  };
  period: {
    from: string;
    to: string;
    days: number;
    prevFrom: string;
    prevTo: string;
    label: string;
  };
  ai: {
    answers: number;
    prevAnswers: number;
    current: Kpis;
    previous: Kpis;
    counts: {
      mentionAnswers: number;
      citedAnswers: number;
      ownCitations: number;
      totalCitations: number;
      trackedPrompts: number;
      engines: number;
      competitors: number;
      sources: number;
      promptsVisible: number;
      promptsInvisible: number;
      promptsWithData: number;
    };
    trend: TrendPoint[];
    brandTrend: BrandTrend;
    brands: BrandRow[];
    engines: EngineRow[];
    sources: SourceRow[];
    sourceTypes: { type: string; label: string; citations: number }[];
    ownPages: PageRow[];
    prompts: PromptRow[];
    coverage: { mentionedCited: number; mentionedOnly: number; citedOnly: number; notVisible: number };
    funnel: { stage: string; label: string; prompts: number; visibility: number | null }[];
    topics: { topic: string; prompts: number; visibility: number | null }[];
    sentimentMix: { praise: number; neutral: number; criticism: number };
    praise: StatementRow[];
    criticism: StatementRow[];
    fanouts: { query: string; count: number }[];
  };
  other: {
    tasks: TaskRow[] | null;
    openTasks: number | null;
    audit: { score: number | null; pages: number; critical: number; warning: number; completedAt: string | null } | null;
    crawlability: { score: number | null; completedAt: string | null } | null;
    searchConsole: { clicks: number; impressions: number; prevClicks: number; prevImpressions: number } | null;
    aiTraffic: { sessions: number; conversions: number; revenue: number; prevSessions: number } | null;
  };
};

/** Empty bundle used while the real one loads (all values null/empty). */
export function emptyBundle(project: { id: string; name: string; domain: string; country?: string }): DataBundle {
  const today = new Date().toISOString().slice(0, 10);
  const nullKpis: Kpis = {
    visibility: null,
    mentionRate: null,
    citationRate: null,
    avgPosition: null,
    sentiment: null,
    shareOfVoice: null,
    geoScore: null,
  };
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      domain: project.domain,
      country: project.country ?? "US",
      clientName: project.name,
      clientLogo: null,
      clientColor: null,
    },
    agency: { name: "", logo: null, website: null, email: null },
    period: { from: today, to: today, days: 30, prevFrom: today, prevTo: today, label: "" },
    ai: {
      answers: 0,
      prevAnswers: 0,
      current: nullKpis,
      previous: nullKpis,
      counts: {
        mentionAnswers: 0,
        citedAnswers: 0,
        ownCitations: 0,
        totalCitations: 0,
        trackedPrompts: 0,
        engines: 0,
        competitors: 0,
        sources: 0,
        promptsVisible: 0,
        promptsInvisible: 0,
        promptsWithData: 0,
      },
      trend: [],
      brandTrend: { brands: [], rows: [] },
      brands: [],
      engines: [],
      sources: [],
      sourceTypes: [],
      ownPages: [],
      prompts: [],
      coverage: { mentionedCited: 0, mentionedOnly: 0, citedOnly: 0, notVisible: 0 },
      funnel: [],
      topics: [],
      sentimentMix: { praise: 0, neutral: 0, criticism: 0 },
      praise: [],
      criticism: [],
      fanouts: [],
    },
    other: { tasks: null, openTasks: null, audit: null, crawlability: null, searchConsole: null, aiTraffic: null },
  };
}
