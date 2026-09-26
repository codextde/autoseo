import { describe, expect, it } from "vitest";
import { canonicalUrlKey, detectUrlTemplate, isSameOrigin, normalizeUrl } from "../url-utils";
import {
  CrawlTargetBlockedError,
  InvalidUrlError,
  isBlockedHost,
  isCrawlableUrl,
  isPrivateAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  normalizeStartUrlInput,
} from "../url-policy";

describe("normalizeUrl", () => {
  it("resolves relative URLs, strips fragments, sorts query params, lowercases host", () => {
    expect(normalizeUrl("/b?z=1&a=2#frag", "https://Example.COM/a/")).toBe("https://example.com/b?a=2&z=1");
  });
  it("preserves trailing slashes (no /docs ↔ /docs/ loops)", () => {
    expect(normalizeUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeUrl("https://example.com/docs/")).toBe("https://example.com/docs/");
  });
  it("rejects non-http(s) schemes and garbage", () => {
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("http://")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  it("treats www and apex as the same site", () => {
    expect(isSameOrigin("https://www.example.com/a", "https://example.com")).toBe(true);
    expect(isSameOrigin("https://example.com/a", "https://www.example.com/")).toBe(true);
  });
  it("allows only the http:80 → https:443 protocol upgrade", () => {
    expect(isSameOrigin("https://example.com/", "http://example.com/")).toBe(true);
    expect(isSameOrigin("http://example.com/", "https://example.com/")).toBe(false);
    expect(isSameOrigin("https://example.com:8443/", "https://example.com/")).toBe(false);
  });
  it("rejects other hosts and subdomains", () => {
    expect(isSameOrigin("https://blog.example.com/", "https://example.com/")).toBe(false);
    expect(isSameOrigin("https://example.com.evil.io/", "https://example.com/")).toBe(false);
  });
});

describe("canonicalUrlKey / detectUrlTemplate", () => {
  it("normalizes protocol and www for homepage matching", () => {
    expect(canonicalUrlKey("http://www.Example.com/?b=1&a=2#x")).toBe("https://example.com/?a=2&b=1");
  });
  it("replaces ids, uuids, dates and long slugs", () => {
    expect(detectUrlTemplate("/products/12345")).toBe("/products/:id");
    expect(detectUrlTemplate("/blog/my-great-post")).toBe("/blog/:slug");
    expect(detectUrlTemplate("/users/my-account/settings")).toBe("/users/my-account/settings");
    expect(detectUrlTemplate("/news/2024-01-15/x")).toBe("/news/:date/x");
    expect(detectUrlTemplate("/o/123e4567-e89b-12d3-a456-426614174000")).toBe("/o/:uuid");
  });
});

describe("SSRF policy", () => {
  it.each([
    ["10.0.0.1", true],
    ["127.0.0.1", true],
    ["0.0.0.0", true],
    ["169.254.169.254", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["100.64.0.1", true],
    ["198.18.0.1", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["93.184.216.34", false],
  ])("IPv4 %s private=%s", (ip, expected) => {
    expect(isPrivateIpv4(ip)).toBe(expected);
  });

  it.each([
    ["::1", true],
    ["::", true],
    ["fd00::1", true],
    ["fc00::abcd", true],
    ["fe80::1", true],
    ["febf::1", true],
    ["ff02::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:7f00:1", true],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::a00:1", true],
    ["2002:c0a8:0101::1", true],
    ["2606:4700:4700::1111", false],
    ["2001:db8::1", true],
  ])("IPv6 %s private=%s", (ip, expected) => {
    expect(isPrivateIpv6(ip)).toBe(expected);
  });

  it("fails closed on unparseable IPv6 addresses", () => {
    expect(isPrivateAddress("12:34:zz::1")).toBe(true);
  });

  it("blocks internal hostnames and metadata endpoints", () => {
    for (const h of ["localhost", "LOCALHOST.", "foo.localhost", "printer.local", "db.internal", "metadata.google.internal", "169.254.169.254", "intranet", "router.home.arpa", "[::1]"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("www.solakon.de")).toBe(false);
  });

  it("isCrawlableUrl rejects private literals, credentials, odd ports and schemes", () => {
    expect(isCrawlableUrl("https://example.com/page")).toBe(true);
    expect(isCrawlableUrl("http://127.0.0.1/")).toBe(false);
    expect(isCrawlableUrl("http://2130706433/")).toBe(false); // decimal 127.0.0.1
    expect(isCrawlableUrl("http://0x7f.0.0.1/")).toBe(false);
    expect(isCrawlableUrl("http://[::ffff:10.0.0.1]/")).toBe(false);
    expect(isCrawlableUrl("http://user:pw@example.com/")).toBe(false);
    expect(isCrawlableUrl("http://example.com:6379/")).toBe(false);
    expect(isCrawlableUrl("file:///etc/passwd")).toBe(false);
    expect(isCrawlableUrl("gopher://example.com/")).toBe(false);
  });

  it("normalizeStartUrlInput adds https:// and rejects blocked targets", () => {
    expect(normalizeStartUrlInput("example.com/x#y")).toBe("https://example.com/x");
    expect(normalizeStartUrlInput(" http://Example.com ")).toBe("http://example.com/");
    expect(() => normalizeStartUrlInput("")).toThrow(InvalidUrlError);
    expect(() => normalizeStartUrlInput("javascript:alert(1)")).toThrow(InvalidUrlError);
    expect(() => normalizeStartUrlInput("localhost:3000")).toThrow(CrawlTargetBlockedError);
    expect(() => normalizeStartUrlInput("http://192.168.0.10/admin")).toThrow(CrawlTargetBlockedError);
  });
});
