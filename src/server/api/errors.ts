import "server-only";

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_token"
  | "forbidden"
  | "insufficient_scope"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "method_not_allowed"
  | "not_configured"
  | "not_connected"
  | "budget_exceeded"
  | "upstream_error"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_token: 401,
  forbidden: 403,
  insufficient_scope: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  method_not_allowed: 405,
  not_configured: 503,
  not_connected: 409,
  budget_exceeded: 402,
  upstream_error: 502,
  internal_error: 500,
};

/** Error thrown inside API / MCP handlers; converted to the JSON envelope (or MCP tool error). */
export class ApiError extends Error {
  status: number;
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
    status?: number,
  ) {
    super(message);
    this.status = status ?? STATUS[code];
  }
}

export const notFound = (what = "Resource") => new ApiError("not_found", `${what} not found.`);

/** Converts zod issues to a compact, client-friendly list. */
export function zodIssues(err: unknown): { path: string; message: string }[] | null {
  if (!err || typeof err !== "object" || !("issues" in err)) return null;
  const issues = (err as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (!Array.isArray(issues)) return null;
  return issues.map((i) => ({ path: i.path.map(String).join(".") || "input", message: i.message }));
}
