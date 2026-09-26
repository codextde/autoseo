import "server-only";
import { z } from "zod";
import type { AiFilterInput } from "./ai-data";
import { ApiError } from "./errors";

/** Query parameters shared by the analytics endpoints (finseo naming + MCP-style aliases). */
export const filterQuery = {
  timeframe: z
    .string()
    .regex(/^\d{1,3}d?$/, "Use e.g. 7d, 14d, 30d, 90d")
    .optional()
    .describe("Look-back window ending today, e.g. 7d, 30d (default 30d)."),
  timeframeDays: z.coerce.number().int().min(1).max(730).optional().describe("Alternative to timeframe (number of days)."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().describe("Custom period start (UTC day); overrides timeframe."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().describe("Custom period end (default today)."),
  model: z.array(z.string().max(40)).max(11).optional().describe("AI model / engine id(s), e.g. chatgpt, perplexity, ai_overview."),
  tags: z.array(z.string().max(80)).max(50).optional().describe("Tag names or ids (prompts with any of the tags)."),
};

/** Keys that may repeat / be comma-separated in the query string. */
export const FILTER_ARRAY_KEYS = ["model", "tags"];

export function toAiFilter(q: {
  timeframe?: string;
  timeframeDays?: number;
  startDate?: string;
  endDate?: string;
  model?: string[];
  tags?: string[];
}): AiFilterInput {
  const days = q.timeframeDays ?? (q.timeframe ? Number.parseInt(q.timeframe, 10) : undefined);
  if (days !== undefined && (!Number.isFinite(days) || days < 1 || days > 730)) {
    throw new ApiError("validation_error", "timeframe must be between 1d and 730d.");
  }
  return { timeframeDays: days, startDate: q.startDate, endDate: q.endDate, model: q.model, tags: q.tags };
}

export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  return {
    items: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export type ProjectParams = { projectId: string };
