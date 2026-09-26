import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Resolve every test hostname to a private address so the connector-level DNS check is exercised.
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  const lookup = (hostname: string, options: unknown, cb: (err: Error | null, addrs?: unknown) => void) => {
    if (hostname === "rebind.example.test") return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    if (hostname === "mixed.example.test") return cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }]);
    return real.lookup(hostname, options as never, cb as never);
  };
  return { ...real, default: { ...real, lookup }, lookup };
});

import { safeFetch, safeFetchFollow } from "../safe-fetch";
import { CrawlTargetBlockedError } from "../url-policy";

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("internal secret");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("safeFetch SSRF guard", () => {
  it("refuses private IP literals before connecting", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(CrawlTargetBlockedError);
  });
  it("refuses hostnames that resolve to a private address (checked on connect)", async () => {
    await expect(safeFetch("http://rebind.example.test/")).rejects.toBeInstanceOf(CrawlTargetBlockedError);
  });
  it("refuses when ANY resolved address is private", async () => {
    await expect(safeFetch("http://mixed.example.test/")).rejects.toBeInstanceOf(CrawlTargetBlockedError);
  });
  it("re-validates redirect targets", async () => {
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
    try {
      // The first hop itself is a private literal → blocked immediately.
      const p = (redirector.address() as AddressInfo).port;
      await expect(safeFetchFollow(`http://127.0.0.1:${p}/`)).rejects.toBeInstanceOf(CrawlTargetBlockedError);
    } finally {
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });
});
