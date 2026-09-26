/** Reads a request body as text, aborting once `maxBytes` is exceeded (also for chunked bodies). */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

/**
 * Client IP as set by the reverse proxy: X-Real-Ip (Traefik / nginx overwrite it), else the right-most
 * X-Forwarded-For hop (appended by the proxy, so not client-controlled), else Cloudflare's header.
 */
export function proxiedClientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",").pop()!.trim() || null;
  return headers.get("cf-connecting-ip");
}
