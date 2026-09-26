import { describe, expect, it } from "vitest";
import { classifyAccess, evaluateRules, isAllowed, matchGroup, parseRobotsTxt, patternMatches } from "../robots";

const ROBOTS = `
# comment
User-agent: *
Disallow: /cart
Disallow: /search?
Allow: /cart/public
Crawl-delay: 2

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /
Allow: /blog/

User-agent: PerplexityBot
Disallow:

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news.xml
Foo: bar
`;

describe("robots.txt parser", () => {
  const robots = parseRobotsTxt(ROBOTS);
  it("parses groups, sitemaps and warnings", () => {
    expect(robots.groups).toHaveLength(4);
    expect(robots.groups[1]!.userAgents).toEqual(["GPTBot", "CCBot"]);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml", "https://example.com/news.xml"]);
    expect(robots.warnings.some((w) => w.message.includes("foo"))).toBe(true);
    expect(matchGroup(robots, "googlebot").crawlDelay).toBe(2);
  });
  it("uses the specific group over the wildcard group (case-insensitive)", () => {
    expect(isAllowed(robots, "gptbot", "https://example.com/anything").allowed).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/").source).toBe("specific");
    expect(isAllowed(robots, "Googlebot", "/").source).toBe("wildcard");
  });
  it("longest match wins; Allow wins ties", () => {
    expect(isAllowed(robots, "Googlebot", "/cart/checkout").allowed).toBe(false);
    expect(isAllowed(robots, "Googlebot", "/cart/public/x").allowed).toBe(true);
    expect(isAllowed(robots, "ClaudeBot", "/blog/post").allowed).toBe(true);
    expect(isAllowed(robots, "ClaudeBot", "/pricing").allowed).toBe(false);
    expect(evaluateRules([{ type: "disallow", path: "/a", line: 1 }, { type: "allow", path: "/a", line: 2 }], "/a").allowed).toBe(true);
  });
  it("empty Disallow allows everything and /robots.txt is always allowed", () => {
    expect(isAllowed(robots, "PerplexityBot", "/cart").allowed).toBe(true);
    expect(isAllowed(robots, "GPTBot", "/robots.txt").allowed).toBe(true);
  });
  it("supports * wildcards and $ anchors", () => {
    expect(patternMatches("/*.pdf$", "/files/a.pdf")).toBe(true);
    expect(patternMatches("/*.pdf$", "/files/a.pdf?x=1")).toBe(false);
    expect(patternMatches("/fish*", "/fish.html")).toBe(true);
    expect(patternMatches("/fish", "/Fish")).toBe(false);
    expect(patternMatches("/*/private/", "/a/private/b")).toBe(true);
    expect(patternMatches("/search?", "/search?q=1")).toBe(true);
    expect(patternMatches("*", "/anything")).toBe(true);
  });
  it("classifies overall access per bot", () => {
    expect(classifyAccess(robots, "GPTBot").status).toBe("blocked");
    expect(classifyAccess(robots, "ClaudeBot").status).toBe("partial");
    expect(classifyAccess(robots, "Googlebot").status).toBe("partial");
    expect(classifyAccess(robots, "PerplexityBot").status).toBe("allowed");
    expect(classifyAccess(parseRobotsTxt(null), "GPTBot").status).toBe("allowed");
  });
});
