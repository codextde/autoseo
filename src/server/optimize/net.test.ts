import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Admin allowlist of internal hosts (Admin → Authentication) — only honoured for purpose "integration".
vi.mock("@/server/settings", () => ({
  getSetting: async () => ({ privateNetworkAllowlist: ["localhost", "127.0.0.1"] }),
}));

import { headersForHop, parsePublicUrl, safeFetch, UnsafeUrlError } from "./net";

type Seen = { path: string; method: string; headers: http.IncomingHttpHeaders; body: string };
let a: http.Server;
let b: http.Server;
let portA = 0;
let portB = 0;
const seenB: Seen[] = [];
const seenA: Seen[] = [];

function listen(server: http.Server) {
  return new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  b = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seenB.push({ path: req.url ?? "", method: req.method ?? "", headers: req.headers, body });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("B");
    });
  });
  portB = await listen(b);
  a = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seenA.push({ path: req.url ?? "", method: req.method ?? "", headers: req.headers, body });
      if (req.url === "/cross") {
        res.writeHead(302, { location: `http://127.0.0.1:${portB}/landing` });
        return res.end();
      }
      if (req.url === "/cross307") {
        res.writeHead(307, { location: `http://127.0.0.1:${portB}/landing` });
        return res.end();
      }
      if (req.url === "/same") {
        res.writeHead(302, { location: `/final` });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("A");
    });
  });
  portA = await listen(a);
});
afterAll(async () => {
  await new Promise<void>((r) => a.close(() => r()));
  await new Promise<void>((r) => b.close(() => r()));
});

const secretHeaders = { authorization: "Basic c2VjcmV0", cookie: "sid=1", "x-api-key": "k", "x-shopify-access-token": "shpat", accept: "application/json" };

describe("safeFetch redirect credential handling", () => {
  it("strips Authorization/Cookie/API-key headers when a redirect changes origin", async () => {
    seenB.length = 0;
    const res = await safeFetch(`http://localhost:${portA}/cross`, { headers: secretHeaders, purpose: "integration" });
    expect(res.status).toBe(200);
    const hit = seenB.at(-1)!;
    expect(hit.headers.authorization).toBeUndefined();
    expect(hit.headers.cookie).toBeUndefined();
    expect(hit.headers["x-api-key"]).toBeUndefined();
    expect(hit.headers["x-shopify-access-token"]).toBeUndefined();
    expect(hit.headers.accept).toBe("application/json");
    expect(hit.headers["user-agent"]).toMatch(/AutoSEO/);
  });

  it("keeps credentials on same-origin redirects", async () => {
    seenA.length = 0;
    await safeFetch(`http://localhost:${portA}/same`, { headers: secretHeaders, purpose: "integration" });
    const final = seenA.find((s) => s.path === "/final")!;
    expect(final.headers.authorization).toBe("Basic c2VjcmV0");
  });

  it("refuses to re-send a request body to another origin (307/308)", async () => {
    seenB.length = 0;
    await expect(
      safeFetch(`http://localhost:${portA}/cross307`, { method: "POST", body: '{"token":"x"}', headers: secretHeaders, purpose: "integration" }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(seenB.length).toBe(0);
  });

  it("does not follow redirects when maxRedirects is 0", async () => {
    await expect(safeFetch(`http://localhost:${portA}/cross`, { purpose: "integration", maxRedirects: 0 })).rejects.toThrow(/redirects/);
  });
});

describe("private-network allowlist scope", () => {
  it("applies to integration calls only — content fetches stay public-only", async () => {
    await expect(safeFetch(`http://127.0.0.1:${portA}/`, { purpose: "content" })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch(`http://localhost:${portA}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    const ok = await safeFetch(`http://127.0.0.1:${portA}/`, { purpose: "integration" });
    expect(ok.text()).toBe("A");
  });
});

describe("parsePublicUrl", () => {
  it("allows only 80/443/8080/8443 for public URLs", () => {
    expect(parsePublicUrl("https://example.com/").port).toBe("");
    expect(parsePublicUrl("https://example.com:8443/x").port).toBe("8443");
    expect(parsePublicUrl("http://example.com:8080/x").port).toBe("8080");
    expect(() => parsePublicUrl("http://example.com:22/")).toThrow(UnsafeUrlError);
    expect(() => parsePublicUrl("http://example.com:6379/")).toThrow(UnsafeUrlError);
  });
  it("blocks private/loopback hosts and non-http schemes", () => {
    for (const u of ["http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest", "http://[::1]/", "http://localhost/", "file:///etc/passwd", "http://user:pw@example.com/"])
      expect(() => parsePublicUrl(u)).toThrow(UnsafeUrlError);
  });
  it("headersForHop keeps only safe headers across origins", () => {
    expect(headersForHop({ Authorization: "x", Accept: "a", "User-Agent": "u", Cookie: "c" }, false)).toEqual({ Accept: "a", "User-Agent": "u" });
    expect(headersForHop({ Authorization: "x" }, true)).toEqual({ Authorization: "x" });
  });
});
