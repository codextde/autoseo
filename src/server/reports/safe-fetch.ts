import "server-only";
import { safeFetchFollow, type SafeResponse } from "@/server/audit-crawler/safe-fetch";

/*
 * SSRF-safe image fetching for server-side exports (PPTX). Uses the audit crawler's client: the
 * private/loopback/link-local/metadata address check runs inside the connector's DNS lookup (the
 * address that is validated is the address that is connected to — no DNS-rebinding window), every
 * redirect hop is re-validated, and the body is streamed with a hard byte cap.
 */

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/;

/** Reads a binary body up to `maxBytes`; returns null (and aborts the stream) when larger. */
export async function readBytesCapped(response: SafeResponse | Response, maxBytes: number): Promise<Buffer | null> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  return Buffer.concat(chunks, total);
}

/** Fetches a public image (≤ maxBytes) and returns it as a data URL, or null. */
export async function fetchPublicImage(raw: string, maxBytes = 8 * 1024 * 1024): Promise<string | null> {
  try {
    const { response } = await safeFetchFollow(raw, { maxHops: 3, timeoutMs: 8000, headers: { Accept: "image/*" } });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (!IMAGE_TYPES.test(type) || declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const buf = await readBytesCapped(response, maxBytes);
    if (!buf || !buf.length) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    // blocked target, timeout, DNS failure, bad URL …
    return null;
  }
}
