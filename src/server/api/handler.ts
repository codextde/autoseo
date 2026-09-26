import "server-only";
import { after, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { getSetting } from "@/server/settings";
import type { Permission } from "@/server/auth/permissions";
import type { ApiScope } from "@/features/api-settings/scopes";
import { resolveCredential, requirePermission, requireScope, type ApiPrincipal } from "./auth";
import { ApiError, zodIssues } from "./errors";
import { toApiError } from "./error-map";
import { logApiRequest } from "./logging";
import { checkRateLimit, clientIp, rateLimitHeaders, type RateLimitResult } from "./rate-limit";
import { readBearer } from "./tokens";
import { CORS_HEADERS, bearerChallenge } from "./urls";

export type AuthOutcome =
  | { ok: true; principal: ApiPrincipal; rate: RateLimitResult }
  | { ok: false; status: 401 | 429; code: "unauthorized" | "invalid_token" | "rate_limited"; message: string; headers: Record<string, string> };

/**
 * Authenticates a bearer credential and applies the per-credential rate limit
 * (`security.apiRateLimitPerMinute`). Failed attempts are rate-limited per IP.
 */
export async function authenticateRequest(req: Request, resourcePath: string): Promise<AuthOutcome> {
  const token = readBearer(req.headers);
  const ip = clientIp(req.headers);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Missing credentials. Send `Authorization: Bearer <api key or OAuth token>`.",
      headers: { "WWW-Authenticate": bearerChallenge(resourcePath) },
    };
  }
  const principal = await resolveCredential(token);
  if (!principal) {
    const fail = checkRateLimit(`authfail:${ip}`, 60);
    if (!fail.allowed) {
      return { ok: false, status: 429, code: "rate_limited", message: "Too many invalid credentials.", headers: rateLimitHeaders(fail) };
    }
    return {
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "The credential is invalid, expired or revoked.",
      headers: {
        "WWW-Authenticate": bearerChallenge(resourcePath, { code: "invalid_token", description: "The access token is invalid or expired" }),
      },
    };
  }
  const { apiRateLimitPerMinute } = await getSetting("security");
  const rate = checkRateLimit(`api:${principal.rateKey}`, apiRateLimitPerMinute);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      code: "rate_limited",
      message: `Rate limit exceeded (${apiRateLimitPerMinute} requests/minute). Retry after ${rate.retryAfter}s.`,
      headers: rateLimitHeaders(rate),
    };
  }
  return { ok: true, principal, rate };
}

/* ───────────────────────────── Envelope ───────────────────────────── */

export type Meta = Record<string, unknown>;

export function envelope(
  status: number,
  body: { data: unknown; meta?: Meta; error: null | { code: string; message: string; details?: unknown } },
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ data: body.data, meta: { requestId, ...(body.meta ?? {}) }, error: body.error }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export function errorResponse(rawErr: unknown, requestId: string, headers: Record<string, string> = {}, resourcePath = "/api/v1"): Response {
  const err = toApiError(rawErr) ?? rawErr;
  if (err instanceof ApiError) {
    const extra: Record<string, string> = { ...headers };
    if (err.code === "insufficient_scope") {
      const scope = (err.details as { requiredScope?: string } | undefined)?.requiredScope;
      extra["WWW-Authenticate"] = bearerChallenge(resourcePath, { code: "insufficient_scope", scope });
    }
    return envelope(err.status, { data: null, error: { code: err.code, message: err.message, details: err.details } }, requestId, extra);
  }
  const issues = zodIssues(err);
  if (issues) {
    return envelope(
      400,
      { data: null, error: { code: "validation_error", message: issues.map((i) => `${i.path}: ${i.message}`).join("; "), details: issues } },
      requestId,
      headers,
    );
  }
  console.error("[api] unhandled error", err);
  return envelope(500, { data: null, error: { code: "internal_error", message: "Internal server error." } }, requestId, headers);
}

/* ───────────────────────────── Route wrapper ───────────────────────────── */

export type ApiResult = { data: unknown; meta?: Meta; status?: number; headers?: Record<string, string> } | Response;

export type ApiHandlerContext<P> = {
  req: NextRequest;
  url: URL;
  principal: ApiPrincipal;
  params: P;
  requestId: string;
};

type RouteParams = Record<string, string | string[] | undefined>;

/**
 * Wraps a REST v1 route handler: bearer auth → per-key rate limit → scope/permission checks →
 * handler → JSON envelope `{ data, meta, error }` → request log (after the response is sent).
 */
export function apiRoute<P extends RouteParams = RouteParams>(
  /** `spend: true` = the endpoint can incur cost (DataForSEO, AI, tracking runs) → also needs the "spend" scope. */
  opts: { scope: ApiScope; permission?: Permission; spend?: boolean },
  fn: (ctx: ApiHandlerContext<P>) => Promise<ApiResult>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const started = performance.now();
    const requestId = `req_${nanoid(16)}`;
    const url = new URL(req.url);
    const auth = await authenticateRequest(req, "/api/v1");
    if (!auth.ok) {
      return envelope(auth.status, { data: null, error: { code: auth.code, message: auth.message } }, requestId, auth.headers);
    }
    const { principal, rate } = auth;
    const rlHeaders = rateLimitHeaders(rate);
    let response: Response;
    try {
      requireScope(principal, opts.scope);
      if (opts.spend) requireScope(principal, "spend");
      if (opts.permission) requirePermission(principal, opts.permission);
      const params = ((await context.params) ?? {}) as P;
      const result = await fn({ req, url, principal, params, requestId });
      if (result instanceof Response) {
        response = result;
        response.headers.set("X-Request-Id", requestId);
        for (const [k, v] of Object.entries({ ...CORS_HEADERS, ...rlHeaders })) response.headers.set(k, v);
      } else {
        response = envelope(result.status ?? 200, { data: result.data, meta: result.meta, error: null }, requestId, {
          ...rlHeaders,
          ...(result.headers ?? {}),
        });
      }
    } catch (err) {
      response = errorResponse(err, requestId, rlHeaders);
    }
    const status = response.status;
    after(() =>
      logApiRequest({
        credentialId: principal.credentialId,
        workspaceId: principal.workspace.id,
        path: url.pathname,
        method: req.method,
        status,
        durationMs: performance.now() - started,
      }),
    );
    return response;
  };
}

/* ───────────────────────────── Input helpers ───────────────────────────── */

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Parses and validates a JSON body (max 2 MB). */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "Request body exceeds 2 MB.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "Request body exceeds 2 MB.");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("validation_error", "Request body must be valid JSON.");
  }
  return schema.parse(json);
}

/**
 * Validates query parameters. Repeated keys become arrays; for array fields a comma-separated
 * single value is split too (`?tags=a,b` ≙ `?tags=a&tags=b`).
 */
export function parseQuery<S extends z.ZodType>(url: URL, schema: S, arrayKeys: string[] = []): z.infer<S> {
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (arrayKeys.includes(key)) obj[key] = values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    else obj[key] = values[values.length - 1]!;
  }
  return schema.parse(obj);
}
