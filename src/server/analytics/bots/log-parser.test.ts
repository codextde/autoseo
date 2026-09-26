import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countLines,
  createLineParser,
  detectLogFormat,
  normalizeFormatOption,
  parseAkamaiRecord,
  parseClfTime,
  parseCloudflareRecord,
  parseCombinedLine,
  parseCustomLine,
  parseIngestBody,
  parseJsonRecord,
  parseTimestamp,
  splitTarget,
  type ParsedHit,
} from "./log-parser";

const fixture = readFileSync(path.join(__dirname, "__fixtures__", "nginx-sample.log"), "utf8");

describe("parseClfTime", () => {
  it("parses nginx/apache timestamps with offsets", () => {
    expect(parseClfTime("10/Oct/2000:13:55:36 -0700")?.toISOString()).toBe("2000-10-10T20:55:36.000Z");
    expect(parseClfTime("24/Sep/2026:09:01:44 +0200")?.toISOString()).toBe("2026-09-24T07:01:44.000Z");
    expect(parseClfTime("nonsense")).toBeNull();
  });
});

describe("parseTimestamp", () => {
  it("handles unix seconds, ms, µs and ns", () => {
    const iso = "2026-09-24T08:00:00.000Z";
    const ms = Date.parse(iso);
    expect(parseTimestamp(ms / 1000)?.toISOString()).toBe(iso);
    expect(parseTimestamp(ms)?.toISOString()).toBe(iso);
    expect(parseTimestamp(ms * 1000)?.toISOString()).toBe(iso);
    expect(parseTimestamp(`${ms}000000`)?.toISOString()).toBe(iso);
  });
  it("handles ISO strings and zone-less timestamps as UTC", () => {
    expect(parseTimestamp("2026-09-24T08:00:00+02:00")?.toISOString()).toBe("2026-09-24T06:00:00.000Z");
    expect(parseTimestamp("2026-09-24 08:00:00")?.toISOString()).toBe("2026-09-24T08:00:00.000Z");
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe("splitTarget", () => {
  it("strips scheme and host from absolute URLs", () => {
    expect(splitTarget("https://Example.com/a/b?c=1#x")).toEqual({ path: "/a/b?c=1", host: "example.com" });
    expect(splitTarget("a/b")).toEqual({ path: "/a/b", host: null });
    expect(splitTarget("")).toEqual({ path: "/", host: null });
  });
});

describe("combined log format", () => {
  it("parses a combined line", () => {
    const hit = parseCombinedLine(fixture.split("\n")[0]!)!;
    expect(hit.ip).toBe("20.171.207.185");
    expect(hit.method).toBe("GET");
    expect(hit.path).toBe("/robots.txt");
    expect(hit.status).toBe(200);
    expect(hit.bytes).toBe(312);
    expect(hit.userAgent).toContain("GPTBot/1.2");
    expect(hit.ts.toISOString()).toBe("2026-09-24T08:15:02.000Z");
  });
  it("parses vhost_combined and common formats", () => {
    const vhost = parseCombinedLine('solakon.de:443 1.2.3.4 - - [24/Sep/2026:08:00:00 +0000] "GET /x HTTP/1.1" 200 10 "-" "curl/8.0"')!;
    expect(vhost.host).toBe("solakon.de");
    expect(vhost.ip).toBe("1.2.3.4");
    const common = parseCombinedLine('1.2.3.4 - frank [24/Sep/2026:08:00:00 +0000] "GET /y HTTP/1.0" 404 -')!;
    expect(common.status).toBe(404);
    expect(common.bytes).toBeNull();
    expect(common.userAgent).toBe("");
  });
  it("parses IPv6 clients", () => {
    const line = fixture.split("\n").find((l) => l.startsWith("2001:"))!;
    expect(parseCombinedLine(line)?.ip).toBe("2001:4860:4801:10::1");
  });
  it("rejects garbage", () => {
    expect(parseCombinedLine("this line is garbage and cannot be parsed")).toBeNull();
  });
});

describe("JSON records", () => {
  it("parses Cloudflare Logpush records (ns timestamps)", () => {
    const hit = parseCloudflareRecord({
      ClientIP: "20.171.207.1",
      ClientRequestHost: "Solakon.de",
      ClientRequestMethod: "GET",
      ClientRequestURI: "/blog?page=2",
      ClientRequestUserAgent: "GPTBot/1.2",
      EdgeResponseStatus: 200,
      EdgeStartTimestamp: 1790000000000000000,
      EdgeResponseBytes: 1234,
    })!;
    expect(hit.path).toBe("/blog?page=2");
    expect(hit.host).toBe("solakon.de");
    expect(hit.ts.getTime()).toBe(1790000000000);
    expect(hit.bytes).toBe(1234);
  });
  it("parses Akamai DataStream 2 records", () => {
    const hit = parseAkamaiRecord({
      reqTimeSec: "1790000000.250",
      cliIP: "3.224.220.101",
      UA: "Mozilla%2F5.0%20(compatible%3B%20PerplexityBot%2F1.0)",
      reqPath: "produkte/solarbank",
      queryStr: "a=1",
      statusCode: "200",
      reqHost: "solakon.de",
      reqMethod: "GET",
      totalBytes: "999",
    })!;
    expect(hit.userAgent).toBe("Mozilla/5.0 (compatible; PerplexityBot/1.0)");
    expect(hit.path).toBe("/produkte/solarbank?a=1");
    expect(hit.status).toBe(200);
    expect(hit.ts.getTime()).toBe(1790000000250);
  });
  it("parses native NDJSON with aliases", () => {
    const hit = parseJsonRecord({ time: "2026-09-24T08:00:00Z", remote_addr: "1.2.3.4, 10.0.0.1", ua: "ClaudeBot/1.0", url: "https://solakon.de/faq", status_code: "301" })!;
    expect(hit.ip).toBe("1.2.3.4");
    expect(hit.path).toBe("/faq");
    expect(hit.host).toBe("solakon.de");
    expect(hit.status).toBe(301);
    expect(parseJsonRecord({ foo: "bar" })).toBeNull();
    expect(parseJsonRecord([1, 2])).toBeNull();
  });
});

describe("custom fallback", () => {
  it("extracts request, time, status and UA heuristically", () => {
    const hit = parseCustomLine('2026-09-24T08:00:00Z edge=fra1 ip=203.0.113.5 "GET /pricing HTTP/1.1" 200 "Mozilla/5.0 (compatible; GPTBot/1.2)"')!;
    expect(hit.path).toBe("/pricing");
    expect(hit.status).toBe(200);
    expect(hit.ip).toBe("203.0.113.5");
    expect(hit.userAgent).toContain("GPTBot");
  });
});

describe("W3C extended", () => {
  it("uses the #Fields header", () => {
    const parser = createLineParser("w3c");
    expect(parser.parse("#Software: Microsoft Internet Information Services 10.0")).toBe("skip");
    expect(parser.parse("#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port c-ip cs(User-Agent) sc-status")).toBe("skip");
    const hit = parser.parse("2026-09-24 08:00:00 10.0.0.1 GET /index.html q=1 443 20.171.207.2 Mozilla/5.0+(compatible;+GPTBot/1.2) 200") as ParsedHit;
    expect(hit.path).toBe("/index.html?q=1");
    expect(hit.userAgent).toBe("Mozilla/5.0 (compatible; GPTBot/1.2)");
    expect(hit.ip).toBe("20.171.207.2");
  });
});

describe("format detection", () => {
  it("detects combined logs", () => {
    expect(detectLogFormat(fixture.split("\n").slice(0, 20))).toBe("combined");
  });
  it("detects JSON flavours", () => {
    expect(detectLogFormat(['{"ClientIP":"1.1.1.1","EdgeStartTimestamp":1}'])).toBe("cloudflare");
    expect(detectLogFormat(['{"cliIP":"1.1.1.1","reqTimeSec":"1"}'])).toBe("akamai");
    expect(detectLogFormat(['{"ip":"1.1.1.1","timestamp":"2026-01-01T00:00:00Z"}'])).toBe("ndjson");
    expect(detectLogFormat(["#Fields: date time c-ip"])).toBe("w3c");
  });
  it("maps UI options", () => {
    expect(normalizeFormatOption("nginx")).toBe("combined");
    expect(normalizeFormatOption("apache")).toBe("combined");
    expect(normalizeFormatOption(undefined)).toBe("auto");
  });
});

describe("full fixture", () => {
  it("parses every valid line and skips garbage", () => {
    const parser = createLineParser(detectLogFormat(fixture.split("\n")));
    const results = fixture.split("\n").map((l) => parser.parse(l)).filter((r) => r !== "skip");
    const hits = results.filter((r): r is ParsedHit => !!r);
    expect(results.length).toBe(15);
    expect(hits.length).toBe(14);
  });
});

describe("ingest body", () => {
  it("parses NDJSON and JSON arrays and counts lines", () => {
    const body = ['{"timestamp":"2026-09-24T08:00:00Z","ip":"1.1.1.1","user_agent":"GPTBot","path":"/a"}', "", "not json", '{"x":1}'].join("\n");
    const res = parseIngestBody(body);
    expect(res.received).toBe(3);
    expect(res.hits.length).toBe(1);
    expect(res.invalid).toBe(2);
    expect(parseIngestBody('[{"timestamp":1790000000,"path":"/b","ua":"x"}]').hits[0]?.path).toBe("/b");
    expect(countLines("a\n\nb\r\n c \n")).toBe(3);
  });
});

describe("pathological input", () => {
  it("stays fast on crafted lines and rejects overlong ones", () => {
    const parser = createLineParser("custom");
    const brackets = `GET / ${"[".repeat(8000)}`;
    const quotes = `GET /x "${'\\"'.repeat(3000)}`;
    const t0 = Date.now();
    parser.parse(brackets);
    parser.parse(quotes);
    parser.parse(`${"a".repeat(8000)} [01/Jan/2026:00:00:00 +0000] "GET / HTTP/1.1" 200 1`);
    expect(parser.parse("x".repeat(20_000))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(250);
  });
  it("rejects oversized JSON arrays", () => {
    const big = `[${'{"timestamp":1,"path":"/","ua":"x"},'.repeat(300_000)}{}]`;
    expect(() => parseIngestBody(big)).toThrow(RangeError);
  });
});
