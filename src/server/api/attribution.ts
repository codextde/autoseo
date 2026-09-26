import "server-only";
import { z } from "zod";
import {
  BULK_LIMIT,
  bulkCreateAttributions,
  createAttribution,
  getAttributionSummary,
  listAttributions,
} from "@/server/attribution/service";
import { ApiError } from "./errors";
import { resolvePeriod } from "./ai-data";

/** Attribution (self-reported "How did you hear about us?" + conversions) via REST v1. */
export const attributionListQuery = z.object({
  from: z.string().max(40).optional().describe("ISO date/time (inclusive)."),
  to: z.string().max(40).optional().describe("ISO date/time (inclusive)."),
  channel: z.string().max(40).optional().describe("ai_search, other, a channel id (search, social, ads, referral, content, other) or all."),
  source: z.string().max(80).optional().describe("provider or provider::formName"),
  status: z.enum(["active", "dismissed", "all"]).default("active"),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

function toDate(v: string | undefined, name: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new ApiError("validation_error", `${name} must be an ISO date.`);
  return d;
}

export async function listAttributionsForApi(projectId: string, q: z.infer<typeof attributionListQuery>) {
  const from = toDate(q.from, "from");
  const toRaw = toDate(q.to, "to");
  const to = toRaw && q.to && q.to.length === 10 ? new Date(toRaw.getTime() + 86_399_999) : toRaw;
  const res = await listAttributions(projectId, {
    from,
    to,
    channel: q.channel,
    source: q.source,
    status: q.status,
    search: q.search,
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
  });
  return {
    items: res.items,
    pagination: { page: q.page, limit: q.limit, total: res.total, totalPages: Math.max(1, Math.ceil(res.total / q.limit)) },
  };
}

export const attributionSummaryQuery = z.object({
  timeframe: z.string().regex(/^\d{1,3}d?$/).optional().describe("e.g. 7d, 30d, 90d (default 30d)."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function attributionSummaryForApi(projectId: string, q: z.infer<typeof attributionSummaryQuery>) {
  const days = q.timeframe ? Number.parseInt(q.timeframe, 10) : undefined;
  if (days !== undefined && (days < 1 || days > 730)) throw new ApiError("validation_error", "timeframe must be between 1d and 730d.");
  const p = resolvePeriod({ timeframeDays: days, startDate: q.startDate, endDate: q.endDate });
  return getAttributionSummary(projectId, { from: new Date(`${p.from}T00:00:00Z`), to: new Date(`${p.to}T23:59:59.999Z`) });
}

export async function createAttributionForApi(projectId: string, body: unknown) {
  return createAttribution(projectId, body, { provider: "api" });
}

export const attributionBulkBody = z.union([
  z.array(z.unknown()).min(1).max(BULK_LIMIT),
  z.object({ items: z.array(z.unknown()).min(1).max(BULK_LIMIT) }),
]);

export async function bulkAttributionsForApi(projectId: string, body: z.infer<typeof attributionBulkBody>) {
  const items = Array.isArray(body) ? body : body.items;
  return bulkCreateAttributions(projectId, items, { provider: "api" });
}

export { BULK_LIMIT };
