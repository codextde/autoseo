import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";
import { rateLimit } from "@/server/rate-limit";
import { clientIpSync } from "@/server/http/request";

const MAX_CACHED = 20_000;
let cachedCount: number | null = null;

function imageType(ct: string | null): string {
  return ct && /^image\/(x-icon|vnd\.microsoft\.icon|png|jpeg|gif|webp)$/.test(ct.split(";")[0]!.trim()) ? ct.split(";")[0]!.trim() : "image/x-icon";
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Cached favicon proxy (avoids leaking viewers' IPs to third parties; only fetches from DuckDuckGo's icon service). */
export async function GET(req: Request, ctx: RouteContext<"/api/favicon/[domain]">) {
  if (!rateLimit(`favicon:${clientIpSync(req.headers) ?? "?"}`, 300, 60_000)) return new Response("Too many requests", { status: 429 });
  const { domain: raw } = await ctx.params;
  const domain = decodeURIComponent(raw).toLowerCase().replace(/^www\./, "");
  if (!DOMAIN_RE.test(domain)) return new Response("Bad domain", { status: 400 });
  const dir = path.join(env.dataDir, "favicons");
  const file = path.join(dir, `${domain}.bin`);
  const headers = {
    "Cache-Control": "public, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TTL_MS) {
      const buf = await fs.readFile(file);
      if (buf.length === 0) return new Response("Not found", { status: 404 });
      return new Response(new Uint8Array(buf), { headers: { ...headers, "Content-Type": "image/x-icon" } });
    }
  } catch {
    // not cached
  }
  try {
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, { signal: AbortSignal.timeout(5000) });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    await fs.mkdir(dir, { recursive: true });
    if (cachedCount === null) cachedCount = (await fs.readdir(dir).catch(() => [])).length;
    // DuckDuckGo returns a generic placeholder for unknown sites — treat tiny images as missing.
    if (cachedCount < MAX_CACHED) {
      await fs.writeFile(file, buf.length > 200 && buf.length < 512 * 1024 ? buf : Buffer.alloc(0));
      cachedCount++;
    }
    if (buf.length <= 200 || buf.length >= 512 * 1024) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(buf), { headers: { ...headers, "Content-Type": imageType(res.headers.get("content-type")) } });
  } catch {
    return new Response(new Uint8Array(EMPTY_PNG), { status: 404, headers: { "Content-Type": "image/png" } });
  }
}
