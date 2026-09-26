import type { NextRequest } from "next/server";
import { processWebhook, WEBHOOK_MAX_BYTES } from "@/server/attribution/webhook";
import { proxiedClientIp, readBodyLimited } from "@/server/attribution/http";

export const dynamic = "force-dynamic";

async function parseForm(raw: string, contentType: string): Promise<Record<string, unknown> | null> {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  if (ct.includes("multipart/form-data")) {
    try {
      const fd = await new Response(raw, { headers: { "content-type": contentType } }).formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Attribution webhook: POST /api/attribution/webhook/<projectId>?token=…[&source=typeform][&workflow=awf_…]
 * Auth via token (query, `X-Attribution-Token` or `Authorization: Bearer`). No cookies, no CORS.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/attribution/webhook/[projectId]">) {
  const { projectId } = await ctx.params;
  const url = req.nextUrl;
  const auth = req.headers.get("authorization");
  const token =
    url.searchParams.get("token") ??
    req.headers.get("x-attribution-token") ??
    (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null);
  // Keep the original case: multipart boundaries are case-sensitive.
  const contentType = req.headers.get("content-type") ?? "";
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > WEBHOOK_MAX_BYTES * 2) return Response.json({ error: "Payload too large" }, { status: 413 });
  // Read up to 2× the limit so oversized payloads are still logged as "too large" by the pipeline.
  const read = await readBodyLimited(req, WEBHOOK_MAX_BYTES * 2);
  if (!read.ok) return Response.json({ error: "Payload too large" }, { status: 413 });
  const rawBody = read.text;
  const formBody = rawBody.length <= WEBHOOK_MAX_BYTES ? await parseForm(rawBody, contentType) : null;
  const source = url.searchParams.get("source");
  const workflow = url.searchParams.get("workflow");
  const result = await processWebhook({
    projectId,
    token,
    source: source && /^[a-z0-9_]{2,40}$/.test(source) ? source : null,
    workflowId: workflow && /^awf_[a-z0-9]{6,40}$/.test(workflow) ? workflow : null,
    rawBody,
    formBody,
    contentType,
    headers: req.headers,
    ip: proxiedClientIp(req.headers),
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return Response.json(
    { ok: true, message: "Attribution webhook endpoint. Send POST requests with JSON and ?token=…" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
