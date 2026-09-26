import "server-only";
import { SeoError } from "@/server/seo/context";
import { SeoValidationError } from "@/server/seo/lib/locations";
import { AuditServiceError } from "@/server/audit-crawler/service";
import { CrawlTargetBlockedError, InvalidUrlError } from "@/server/audit-crawler/url-policy";
import { CrawlabilityError } from "@/server/crawlability/service";
import { DataForSeoError, DataForSeoNotConfiguredError } from "@/server/dataforseo/client";
import { AiNotConfiguredError } from "@/server/ai/llm";
import { BudgetExceededError } from "@/server/usage";
import { GoogleNotConfiguredError, GoogleNotConnectedError, GoogleReconnectRequiredError } from "@/server/integrations/google/oauth";
import { TrackingError } from "@/server/ai/tracking/runs";
import { UnsafeUrlError as TrackingUnsafeUrlError } from "@/server/ai/tracking/safe-fetch";
import { UnsafeUrlError as KnowledgeUnsafeUrlError } from "@/server/ai/knowledge/safe-fetch";
import { UnsafeUrlError as OptimizeUnsafeUrlError } from "@/server/optimize/net";
import { ActionError } from "@/server/auth/guards";
import { InspectionError } from "@/server/analytics/search-console/inspection";
import { ApiError, type ApiErrorCode } from "./errors";

const SEO_CODES: Record<SeoError["code"], ApiErrorCode> = {
  NOT_CONFIGURED: "not_configured",
  PERMISSION: "forbidden",
  VALIDATION_ERROR: "validation_error",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  BUDGET: "budget_exceeded",
  AUTH_FAILED: "not_configured",
  INSUFFICIENT_FUNDS: "budget_exceeded",
  UPSTREAM: "upstream_error",
};

const AUDIT_CODES: Record<AuditServiceError["code"], ApiErrorCode> = {
  VALIDATION_ERROR: "validation_error",
  CRAWL_TARGET_BLOCKED: "validation_error",
  AUDIT_ALREADY_RUNNING: "conflict",
  NOT_FOUND: "not_found",
  PROVIDER_NOT_CONFIGURED: "not_configured",
  INVALID_STATE: "conflict",
};

const CRAWLABILITY_CODES: Record<CrawlabilityError["code"], ApiErrorCode> = {
  VALIDATION_ERROR: "validation_error",
  CRAWL_TARGET_BLOCKED: "validation_error",
  ALREADY_RUNNING: "conflict",
  NOT_FOUND: "not_found",
  AI_NOT_CONFIGURED: "not_configured",
};

const INSPECTION_CODES: Record<InspectionError["code"], ApiErrorCode> = {
  not_connected: "not_connected",
  reconnect_required: "not_connected",
  url_not_in_property: "validation_error",
  invalid_url: "validation_error",
  quota_exceeded: "rate_limited",
  rate_limited: "rate_limited",
  upstream_error: "upstream_error",
};

const ACTION_CODES: Record<ActionError["code"], ApiErrorCode> = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  not_found: "not_found",
  invalid: "validation_error",
  conflict: "conflict",
  error: "validation_error",
};

/**
 * Maps errors thrown by module services (SEO, audit, crawlability, DataForSEO, AI, Google…) to API
 * errors with a stable code + HTTP status, so REST and MCP report them consistently. Returns null
 * for unknown errors (→ 500 / generic tool error).
 */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof SeoError) return new ApiError(SEO_CODES[err.code] ?? "upstream_error", err.message, { module: "seo", code: err.code });
  if (err instanceof SeoValidationError) return new ApiError("validation_error", err.message);
  if (err instanceof AuditServiceError) return new ApiError(AUDIT_CODES[err.code] ?? "validation_error", err.message, { module: "audit", code: err.code });
  if (err instanceof CrawlabilityError) return new ApiError(CRAWLABILITY_CODES[err.code] ?? "validation_error", err.message, { module: "crawlability", code: err.code });
  if (err instanceof CrawlTargetBlockedError || err instanceof InvalidUrlError) return new ApiError("validation_error", err.message);
  if (err instanceof DataForSeoNotConfiguredError) return new ApiError("not_configured", err.message);
  if (err instanceof DataForSeoError) return new ApiError("upstream_error", `DataForSEO: ${err.message}`);
  if (err instanceof AiNotConfiguredError) return new ApiError("not_configured", err.message);
  if (err instanceof BudgetExceededError) return new ApiError("budget_exceeded", err.message);
  if (err instanceof GoogleNotConfiguredError) return new ApiError("not_configured", err.message);
  if (err instanceof GoogleNotConnectedError || err instanceof GoogleReconnectRequiredError) {
    return new ApiError("not_connected", `${err.message} Connect it in the project's Integrations page.`);
  }
  if (err instanceof TrackingError) return new ApiError("validation_error", err.message);
  if (err instanceof TrackingUnsafeUrlError || err instanceof KnowledgeUnsafeUrlError || err instanceof OptimizeUnsafeUrlError) {
    return new ApiError("validation_error", err.message || "This URL is not allowed (private or unsafe address).");
  }
  if (err instanceof InspectionError) return new ApiError(INSPECTION_CODES[err.code] ?? "upstream_error", err.message, { module: "search_console", code: err.code });
  if (err instanceof ActionError) return new ApiError(ACTION_CODES[err.code] ?? "validation_error", err.message);
  return null;
}
