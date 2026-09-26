import zlib from "node:zlib";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrations, type BotVisitSource } from "@/server/db/schema";
import { findIntegrationByToken, INGEST_TOKEN_PREFIX } from "@/server/integrations/store";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { rateLimit } from "@/server/rate-limit";
import { clientIpSync } from "@/server/http/request";
import { countLines, parseIngestBody } from "@/server/analytics/bots/log-parser";
import { ingestHits } from "@/server/analytics/bots/ingest";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_LINES = 20_000;
const RATE_LIMIT_PER_MINUTE = 1200;

const gunzip = promisify(zlib.gunzip);

/* Invalid-token attempts per client IP (sliding 1-minute window, single instance). */
const BAD_ATTEMPTS_PER_MINUTE = 30;
const badAttempts = new Map<string, number[]>();

function tooManyBadAttempts(ip: string): boolean {
  const now = Date.now();
  const hits = (badAttempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length) badAttempts.set(ip, hits);
  else badAttempts.delete(ip);
  return hits.length >= BAD_ATTEMPTS_PER_MINUTE;
}

function recordBadAttempt(ip: string) {
  const hits = badAttempts.get(ip) ?? [];
  hits.push(Date.now());
  badAttempts.set(ip, hits);
  if (badAttempts.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of badAttempts) if (!v.some((t) => now - t < 60_000)) badAttempts.delete(k);
  }
}

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function sourceFor(provider: string): BotVisitSource | null {
  if (provider === PROVIDERS.serverLogs) return "api";
  if (provider === PROVIDERS.cloudflare) return "cloudflare";
  if (provider === PROVIDERS.akamai) return "akamai";
  return null;
}

/** Reads the request body with a hard cap (Content-Length is not trusted). */
async function readBody(req: Request): Promise<Buffer | "too_large"> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * NDJSON ingest for AI-crawler requests (server logs, Cloudflare Worker/Logpush, Akamai DataStream 2).
 * Auth: `Authorization: Bearer fslg_…` (per project & connector). Limits: 16 MB body, 20 000 lines.
 * Response: `{ success, received, botVisits, saved }`.
 */
export async function POST(req: Request) {
  // Unauthenticated / bad-token attempts are throttled per client IP before touching the database.
  const ip = clientIpSync(req.headers) ?? "unknown";
  if (tooManyBadAttempts(ip)) {
    return json({ success: false, error: "Too many invalid token attempts — try again later." }, 429, { "Retry-After": "60" });
  }
  const unauthorized = () => {
    recordBadAttempt(ip);
    return json({ success: false, error: "Missing or invalid bearer token." }, 401, { "WWW-Authenticate": "Bearer" });
  };
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(INGEST_TOKEN_PREFIX)) return unauthorized();
  const integration = await findIntegrationByToken(token);
  const source = integration ? sourceFor(integration.provider) : null;
  if (!integration || !source) return unauthorized();
  if (!rateLimit(`server-logs:${integration.id}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return json({ success: false, error: "Rate limit exceeded — max 1200 requests per minute per token." }, 429, { "Retry-After": "60" });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ success: false, error: "Payload too large (max 16 MB)." }, 413);

  const raw = await readBody(req);
  if (raw === "too_large") return json({ success: false, error: "Payload too large (max 16 MB)." }, 413);

  let body = raw;
  const encoding = (req.headers.get("content-encoding") ?? "").toLowerCase();
  const isGzip = encoding.includes("gzip") || (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b);
  if (isGzip) {
    try {
      body = await gunzip(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    } catch (err) {
      if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE")
        return json({ success: false, error: "Decompressed payload too large (max 64 MB)." }, 413);
      return json({ success: false, error: "Invalid gzip payload." }, 400);
    }
  }
  const text = body.toString("utf8");
  if (!text.trim()) return json({ success: true, received: 0, botVisits: 0, saved: 0 });
  const lines = countLines(text);
  if (lines > MAX_LINES) return json({ success: false, error: `Too many lines (${lines}); max 20000 per request.` }, 413);

  let parsed: ReturnType<typeof parseIngestBody>;
  try {
    parsed = parseIngestBody(text);
  } catch (err) {
    if (err instanceof RangeError) return json({ success: false, error: err.message }, 413);
    throw err;
  }
  // A JSON-array body is a single "line" — enforce the record limit as well.
  if (parsed.received > MAX_LINES) return json({ success: false, error: `Too many records (${parsed.received}); max 20000 per request.` }, 413);
  const result = await ingestHits(integration.projectId, source, parsed.hits, { received: parsed.received });

  // Throttled "last received" marker on the connector (at most once a minute).
  if (!integration.lastSyncAt || Date.now() - integration.lastSyncAt.getTime() > 60_000) {
    await db.update(integrations).set({ lastSyncAt: new Date(), lastError: null }).where(eq(integrations.id, integration.id));
  }
  return json({ success: true, received: result.received, botVisits: result.botVisits, saved: result.saved });
}

export function GET() {
  return json({ success: false, error: "Use POST with an NDJSON body and `Authorization: Bearer fslg_…`." }, 405, { Allow: "POST" });
}
