/** Result shapes of the free tools (shared by the server runners and the client views). Port of open-seo §22. */

export type OrganicMetrics = {
  organicTraffic: number | null;
  organicKeywords: number | null;
  trafficValue: number | null;
};

export type RankedKeywordRow = {
  keyword: string | null;
  searchVolume: number | null;
  difficulty: number | null;
  position: number | null;
  url: string | null;
};

export type RelevantPageRow = { url: string | null; traffic: number | null; keywords: number | null };

export type KeywordIdea = { keyword: string; searchVolume: number | null; difficulty: number | null };

export type BacklinkCheckResult = {
  target: string;
  summary: { rank: number | null; backlinks: number | null; referringDomains: number | null; brokenBacklinks: number | null };
  topBacklinks: Array<{
    domainFrom: string | null;
    urlFrom: string | null;
    urlTo: string | null;
    pageTitle: string | null;
    anchor: string | null;
    dofollow: boolean | null;
    domainRank: number | null;
  }>;
};

export type SpamCheckResult = {
  target: string;
  spamScore: number | null;
  targetSpamScore: number | null;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  worstBacklinks: Array<{
    domainFrom: string | null;
    urlFrom: string | null;
    anchor: string | null;
    dofollow: boolean | null;
    domainRank: number | null;
    spamScore: number | null;
  }>;
};

export type DomainTraffic = OrganicMetrics & {
  domain: string;
  topKeywords: RankedKeywordRow[];
  topPages: RelevantPageRow[];
  totalPages: number | null;
};

export type TrafficCheckResult = { locationCode: number; primary: DomainTraffic; comparison: DomainTraffic | null };

export type GapRow = RankedKeywordRow & { traffic: number | null };

export type CompetitorAnalysisResult = {
  competitor: string;
  yourDomain: string | null;
  locationCode: number;
  keywords: RankedKeywordRow[];
  totalKeywords: number | null;
  pages: RelevantPageRow[];
  totalPages: number | null;
  comparison: { competitor: OrganicMetrics; you: OrganicMetrics } | null;
  /** null when no domain was given OR when the gap lookup failed (see `gapFailed`); [] = worked, found nothing. */
  gap: GapRow[] | null;
  gapFailed: boolean;
};

export type KeywordFinderResult = { target: string; locationCode: number; keywords: RankedKeywordRow[] };

export type KeywordGeneratorResult = { keyword: string; locationCode: number; keywords: KeywordIdea[] };

export type DomainAgeRow = {
  domain: string;
  created: string | null;
  updated: string | null;
  expires: string | null;
  registrar: string | null;
  ageYears: number | null;
  ageMonths: number | null;
  error: string | null;
};

export type DomainAgeResult = { rows: DomainAgeRow[] };

export type ToolRunResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
