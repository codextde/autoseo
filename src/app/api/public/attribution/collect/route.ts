import type { NextRequest } from "next/server";
import { COLLECT_MAX_BYTES, handleCollect } from "@/server/attribution/collect";
import { proxiedClientIp, readBodyLimited } from "@/server/attribution/http";

export const dynamic = "force-dynamic";

// CORS: `Access-Control-Allow-Origin: *` is added for /api/public/* in next.config.ts.
// No credentials, no cookies are ever read or set here.
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Snippet / pixel events: POST text/plain (or application/json) JSON ≤ 16 KB. */
export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > COLLECT_MAX_BYTES) return Response.json({ error: "Payload too large" }, { status: 413, headers: CORS_HEADERS });
  const read = await readBodyLimited(req, COLLECT_MAX_BYTES);
  if (!read.ok) return Response.json({ error: "Payload too large" }, { status: 413, headers: CORS_HEADERS });
  const result = await handleCollect({ body: read.text, ip: proxiedClientIp(req.headers), origin: req.headers.get("origin") });
  if (result.status === 204) return new Response(null, { status: 204, headers: CORS_HEADERS });
  return Response.json({ error: result.error }, { status: result.status, headers: CORS_HEADERS });
}
