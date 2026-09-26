/**
 * SEO module public API (keyword research, saved keywords, SERP, domain overview, backlinks, rank tracking,
 * local SEO). Every service takes a plain `SeoContext` (see `context.ts`) + typed input — no Next.js request
 * objects — so server actions, jobs and the MCP server share the same business logic.
 */
export { seoContextFromProject, systemSeoContext, SeoError, assertCanRun, type SeoContext, type SeoErrorCode } from "./context";
export { isDataForSeoConfigured, toSeoError } from "./dfs";

// Keyword research + SERP + metrics
export {
  researchKeywords,
  researchKeywordsInput,
  getSerpAnalysis,
  serpAnalysisInput,
  fetchKeywordMetricsForList,
  upsertKeywordMetrics,
  type ResearchKeywordsInput,
  type ResearchKeywordsOutput,
} from "./keywords";

// Saved keywords
export {
  saveKeywords,
  saveKeywordsInput,
  listSavedKeywords,
  listSavedKeywordsInput,
  exportSavedKeywords,
  listTagSummaries,
  updateSavedKeywordTags,
  updateSavedKeywordTag,
  deleteSavedKeywordTag,
  removeSavedKeywords,
  refreshSavedKeywordMetrics,
  enqueueSavedKeywordMetricsRefresh,
  type SavedKeywordRow,
  type SavedKeywordTagSummary,
} from "./saved-keywords";

// Domain overview
export {
  getDomainOverview,
  getDomainKeywordsPage,
  getDomainPagesPage,
  getDomainKeywordSuggestions,
  findSerpCompetitors,
  type DomainOverviewResult,
  type DomainKeywordSuggestion,
  type SerpCompetitor,
} from "./domain";

// Backlinks
export { getBacklinksOverview, peekBacklinksOverview, getBacklinksRows, getReferringDomains, getBacklinksTopPages, getAhrefsDomainRatings } from "./backlinks";

// Rank tracking
export {
  listRankConfigs,
  listRankConfigSummaries,
  getConfig as getRankConfig,
  createRankConfig,
  updateRankConfig,
  archiveRankConfig,
  getConfigKeywords as getRankConfigKeywords,
  addTrackingKeywords,
  removeTrackingKeywords,
  estimateRankTrackerCost,
  triggerRankCheck,
  getLatestRankRun,
  getRankTrackingResults,
  getRankKeywordHistory,
  getRankConfigTrend,
  getRankPositionMatrix,
  enqueueTrackingKeywordMetricsRefresh,
  getTrackerKeywordSuggestions,
  searchSerpLocations,
  prewarmSerpLocations,
  type RankConfig,
  type RankConfigSummary,
  type RankRunView,
  type RankTrackingRow,
  type RankCheckTriggerResult,
} from "./rank-tracking";
export { executeRankCheck, collectQueuedRound, refreshTrackingKeywordMetrics, runScheduledRankChecks } from "./rank-engine";

// Local SEO
export {
  createLocalRun,
  listLocalRuns,
  getLocalRun,
  deleteLocalRun,
  retryLocalCollect,
  estimateLocalRunCost,
  listBusinessCategories,
  geocodePlace,
  LOCAL_TOOL_SCHEMAS,
  type LocalRun,
  type LocalRunTool,
} from "./local";

// Search history
export { addSearchHistory, listSearchHistory, removeSearchHistory, clearSearchHistory, type SearchFeature } from "./history";
