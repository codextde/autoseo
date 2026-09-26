import "server-only";
/**
 * Public server API of the attribution module (used by the REST v1 / MCP layer, jobs and pages).
 *
 *   listAttributions(projectId, { from, to, channel, source, status, search, limit ≤ 1000, offset })
 *   createAttribution(projectId, { channelId, respondentEmail, dealValue, dealCurrency, … })
 *   bulkCreateAttributions(projectId, items[])            // ≤ 1000 items, per-item errors
 *   getAttributionSummary(projectId, { from, to })          // KPIs, by channel / AI assistant, daily series
 *
 * Inputs use the webhook field names (channelId required; respondentEmail is SHA-256 hashed on arrival).
 * Callers must check project access first — every function is scoped by projectId.
 */
export {
  listAttributions,
  getAttribution,
  createAttribution,
  bulkCreateAttributions,
  getAttributionSummary,
  setAttributionStatus,
  listFiltersSchema,
  createAttributionSchema,
  BULK_LIMIT,
  type AttributionDTO,
  type AttributionDetail,
  type AttributionSummary,
  type ListFilters,
  type CreateAttributionInput,
} from "./service";
export { ingestConversion, ingestResponse } from "./ingest";
export { getAttributionSettings } from "./settings";
