import "server-only";
import { DataForSeoNotConfiguredError, isDataForSeoConfigured } from "@/server/dataforseo/client";
import { env } from "@/server/env";
import { clientIp, hasContentType, isSameOrigin } from "@/server/http/request";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/settings";
import { BudgetExceededError } from "@/server/usage";
import type { FreeToolSlug } from "@/features/free-tools/lib/registry";
import { recordToolEvent, reserveToolBudget, visitorHash } from "./budget";
import { ipIdentity, utcDay } from "./domain";
import { executeTool, type EngineOutcome } from "./engine";
import { dataforseoFetcher, lookupDomainAge } from "./providers";
import { RESERVED_MICRO_USD_PER_CALL, isPaidTool } from "./spend";
import { getServerTool } from "./tools";
import { verifyTurnstile } from "./turnstile";

/** Max JSON body of a public tool request (open-seo `readToolBody`). */
export const MAX_TOOL_BODY_BYTES = 16_384;
const RATE_WINDOW_MS = 60_000;
const UNAVAILABLE = "This tool is temporarily unavailable. Please try again later.";
const VISITOR_LIMIT = "You've hit today's free limit. Try again tomorrow, or sign in for the full workspace.";
const TOOL_LIMIT = "This free tool has reached today's limit. Try again tomorrow, or sign in to keep researching.";

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Exact `application/json` (415), stream-read ≤ 16 KiB without trusting Content-Length (413), JSON parse (400). */
export async function readToolBody(req: Request): Promise<unknown | Response> {
  if (!hasContentType(req, "application/json")) return jsonResponse({ error: "Send a JSON request" }, 415);
  const reader = req.body?.getReader();
  if (!reader) return jsonResponse({ error: "Invalid request" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TOOL_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return jsonResponse({ error: "Request is too large" }, 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return jsonResponse({ error: "Invalid JSON request" }, 400);
  } finally {
    reader.releaseLock();
  }
}

/** Turnstile must have been solved on our own public hostname (never trust client-sent Host headers). */
function turnstileHostnames(): string[] {
  try {
    return [new URL(env.appUrl).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

/**
 * Public free-tool API (open-seo protection pipeline, in order):
 * enabled switch (404) → exact JSON (415) / ≤16 KiB (413) / parse (400) → zod + normalizeDomain (400) →
 * DataForSEO configured (503) → same-origin (403) → per-IP rate limit across all tools (429 + Retry-After) →
 * Turnstile siteverify when a secret is set (403 / 503) → result cache (hits never spend) → atomic daily budget
 * reservation (429) → DataForSEO (502 on failure, failure envelope cached 120 s).
 * `opts.day` overrides the ledger's UTC day (tests only).
 */
export async function handleFreeToolRequest(req: Request, slug: string, opts: { day?: string } = {}): Promise<Response> {
  const settings = await getSetting("freeTools");
  const tool = getServerTool(slug);
  if (!settings.publicEnabled || !tool) return jsonResponse({ error: "Not found" }, 404);
  const toolSlug = tool.slug as FreeToolSlug;

  const body = await readToolBody(req);
  if (body instanceof Response) return body;
  const parsed = tool.parse(body);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  const paid = isPaidTool(toolSlug);
  if (paid && !(await isDataForSeoConfigured())) {
    console.error(`[free-tools] DataForSEO is not configured (${toolSlug})`);
    return jsonResponse({ error: "Service temporarily unavailable" }, 503);
  }

  const day = opts.day ?? utcDay();
  const realIp = await clientIp(req.headers);
  if (!realIp && env.isProduction) {
    // Next.js always sets X-Forwarded-For from the socket; a missing IP means a broken proxy setup → fail closed.
    console.error("[free-tools] no client IP on a public tool request; refusing (check the reverse proxy headers)");
    return jsonResponse({ error: UNAVAILABLE }, 503);
  }
  const ip = ipIdentity(realIp ?? "local");
  const refuse = async (status: number, error: string, headers: Record<string, string> = {}) => {
    // Count refusals for the admin stats, but cap the DB writes one client can cause.
    if (rateLimit(`free-tools:blocked:${ip}`, 20, RATE_WINDOW_MS)) await recordToolEvent(toolSlug, day, { blocked: 1 });
    return jsonResponse({ error }, status, headers);
  };

  if (!isSameOrigin(req)) return refuse(403, "Cross-site submissions are not allowed");

  // Across all tools and before siteverify, so switching tools cannot reset the allowance and invalid tokens
  // cannot flood the verification service.
  if (!rateLimit(`free-tools:${ip}`, settings.perIpPerMinute, RATE_WINDOW_MS)) {
    return refuse(429, "Too many checks. Try again in a minute.", { "Retry-After": "60" });
  }

  const secret = settings.turnstileSecretKey.trim();
  if (secret) {
    const token = (body as { turnstileToken?: unknown } | null)?.turnstileToken;
    const verdict = await verifyTurnstile({ secret, token: typeof token === "string" ? token : undefined, ip: realIp, hostnames: turnstileHostnames() });
    if (verdict === "unavailable") return jsonResponse({ error: UNAVAILABLE }, 503);
    if (verdict === "failed") return refuse(403, "Human verification failed. Refresh the page and try again.");
  }

  const visitor = visitorHash(day, ip);
  const perCallUsd = paid ? RESERVED_MICRO_USD_PER_CALL[toolSlug as keyof typeof RESERVED_MICRO_USD_PER_CALL] / 1_000_000 : 0;
  let outcome: EngineOutcome;
  try {
    outcome = await executeTool(tool, parsed.params, {
      providers: {
        dfs: dataforseoFetcher({ feature: "free_tools_public", projectId: null, workspaceId: null, userId: null }, perCallUsd),
        rdap: lookupDomainAge,
      },
      reserve: paid
        ? async (calls) => {
            const decision = await reserveToolBudget({
              tool: toolSlug as keyof typeof RESERVED_MICRO_USD_PER_CALL,
              calls,
              visitor,
              day,
              limits: {
                maxCallsPerDay: settings.maxCallsPerDay,
                dailyBudgetUsd: settings.dailyBudgetUsd,
                perVisitorCallsPerDay: settings.perVisitorCallsPerDay,
              },
            });
            if (decision === "allowed") return null;
            return { status: 429, error: decision === "visitor" ? VISITOR_LIMIT : TOOL_LIMIT };
          }
        : undefined,
    });
  } catch (err) {
    // Cache / ledger unavailable → fail closed, never spend without a reservation.
    console.error(`[free-tools] ${toolSlug} pipeline unavailable:`, err);
    return jsonResponse({ error: UNAVAILABLE }, 503);
  }

  if (!outcome.ok) {
    if (outcome.status === 429) return jsonResponse({ error: outcome.error }, 429);
    if (outcome.cause instanceof BudgetExceededError) return refuse(429, TOOL_LIMIT);
    if (outcome.cause instanceof DataForSeoNotConfiguredError) return jsonResponse({ error: "Service temporarily unavailable" }, 503);
    // Short max-age so a failing target isn't retried in a loop.
    return jsonResponse({ error: outcome.error }, 502);
  }

  await recordToolEvent(toolSlug, day, { runs: 1, cacheHits: outcome.cacheHit ? 1 : 0 });
  return jsonResponse(outcome.data, 200);
}
