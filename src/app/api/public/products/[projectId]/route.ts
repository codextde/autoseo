import { NextResponse } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { MAX_PRODUCTS_PER_IMPORT, recordImport, upsertProducts, verifyPushToken } from "@/server/ai/knowledge/products";
import { clientIpSync } from "@/server/http/request";

/**
 * Product stream push API (Brand Knowledge → Products → "API").
 *
 *   POST /api/public/products/{projectId}
 *   Authorization: Bearer aps_…            (token shown once in the UI, stored as SHA-256)
 *   Content-Type: application/json
 *   Body: [ { "sku": "…", "name": "…", "url": "…", "image_url": "…", "price": 19.9, "currency": "EUR", … } ]
 *     or  { "products": [ … ], "replace": false }
 *
 * `replace: true` removes previously pushed products that are missing from the payload.
 */

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/public/products/[projectId]">) {
  const { projectId } = await ctx.params;
  if (!/^prj_[a-z0-9]{6,40}$/i.test(projectId)) return error(404, "Unknown project.");
  const ip = clientIpSync(req.headers) ?? "unknown";
  if (!rateLimit(`product-push:${projectId}`, 60, 60_000) || !rateLimit(`product-push-ip:${ip}`, 120, 60_000))
    return error(429, "Too many requests. Please slow down.");

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (!token || !(await verifyPushToken(projectId, token))) return error(401, "Invalid or missing bearer token.");

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return error(413, "Payload too large (max 10 MB).");
  let text: string;
  try {
    text = await req.text();
  } catch {
    return error(400, "Could not read the request body.");
  }
  if (text.length > MAX_BODY_BYTES) return error(413, "Payload too large (max 10 MB).");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, "Body must be valid JSON.");
  }
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? (body as { products?: unknown }).products : null;
  const replace = Boolean(body && typeof body === "object" && !Array.isArray(body) && (body as { replace?: unknown }).replace === true);
  if (!Array.isArray(list)) return error(400, "Send a JSON array of products or { \"products\": [...] }.");
  if (list.length === 0) return error(400, "No products in payload.");
  if (list.length > MAX_PRODUCTS_PER_IMPORT) return error(413, `At most ${MAX_PRODUCTS_PER_IMPORT} products per request.`);
  const items = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));

  try {
    const stats = await upsertProducts(projectId, items, "api", { replace });
    await recordImport(projectId, "api", stats);
    return NextResponse.json({ ok: true, ...stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return error(422, err instanceof Error ? err.message : "Import failed.");
  }
}
