import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * SSRF-safe HTTP GET for user-supplied URLs (e.g. a project's homepage):
 * - http(s) only, default ports only, no credentials in the URL
 * - every DNS answer is checked; private / loopback / link-local / reserved ranges are blocked
 * - the connection is pinned to the validated address (no DNS rebinding)
 * - redirects are followed manually (max 5) and re-validated
 * - response size and time are capped
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const v = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (v & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(x)) return true;
    const first = parseInt(x.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (x.startsWith("64:ff9b:") || x.startsWith("2001:db8:") || x.startsWith("100::")) return true;
    return false;
  }
  return true;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, "", 4);
    if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
      const e = new Error(`Blocked: ${hostname} resolves to a private or reserved address.`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return cb(e, "", 4);
    }
    if (options.all) cb(null, addresses);
    else cb(null, addresses[0]!.address, addresses[0]!.family);
  });
}

let agent: Agent | null = null;
function getAgent(): Agent {
  agent ??= new Agent({
    connect: { lookup: safeLookup as unknown as net.LookupFunction, timeout: 8_000 },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  return agent;
}

export class UnsafeUrlError extends Error {}

function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("Only default ports are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedIp(host)) throw new UnsafeUrlError("Private or reserved addresses are not allowed.");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new UnsafeUrlError("Local hostnames are not allowed.");
  return url;
}

export async function safeFetchText(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<{ url: string; status: number; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop < 6; hop++) {
    const res = await undiciFetch(url, {
      dispatcher: getAgent(),
      redirect: "manual",
      signal: deadline,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AutoSEO/1.0; +https://github.com/autoseo)",
        Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en;q=0.8,*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = assertSafeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", body };
  }
  throw new UnsafeUrlError("Too many redirects.");
}
