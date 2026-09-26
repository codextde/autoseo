import { describe, expect, it } from "vitest";
import { countInlinks, findBrokenInternalLinks, findDuplicates, findOrphanPages, findRedirectChainsAndLoops, type LinkGraphPage, type SlimPage } from "../multipage-checks";

const slim = (url: string, o: Partial<SlimPage> = {}): SlimPage => ({
  id: url,
  url,
  statusCode: 200,
  fetchClass: "ok",
  title: `Title ${url}`,
  metaDescription: `Meta ${url}`,
  contentHash: `hash-${url}`,
  redirectUrl: null,
  wordCount: 300,
  isIndexable: true,
  canonicalUrl: null,
  headerCanonicalUrl: null,
  ...o,
});

describe("duplicates", () => {
  it("groups identical titles, metas and content hashes", () => {
    const pages = [
      slim("https://e.com/a", { title: "Same", metaDescription: "Same meta", contentHash: "h" }),
      slim("https://e.com/b", { title: "Same", metaDescription: "Same meta", contentHash: "h" }),
      slim("https://e.com/c", { title: "Same" }),
    ];
    const issues = findDuplicates(pages);
    const count = (t: string) => issues.filter((i) => i.issueType === t).length;
    expect(count("duplicate-title")).toBe(3);
    expect(count("duplicate-meta-description")).toBe(2);
    expect(count("duplicate-content")).toBe(2);
    const a = issues.find((i) => i.issueType === "duplicate-title" && i.pageUrl === "https://e.com/a")!;
    expect(a.details).toEqual({ groupSize: 3, otherUrls: ["https://e.com/b", "https://e.com/c"] });
  });
  it("excludes noindex, canonicalized, non-2xx and empty pages", () => {
    const pages = [
      slim("https://e.com/a", { title: "Same", contentHash: "h" }),
      slim("https://e.com/b", { title: "Same", contentHash: "h", isIndexable: false }),
      slim("https://e.com/c", { title: "Same", contentHash: "h", canonicalUrl: "https://e.com/a" }),
      slim("https://e.com/d", { title: "Same", contentHash: "h", statusCode: 404 }),
      slim("https://e.com/e", { title: "", contentHash: "z", wordCount: 0 }),
      slim("https://e.com/f", { title: "", contentHash: "z", wordCount: 0 }),
    ];
    expect(findDuplicates(pages)).toEqual([]);
  });
});

describe("redirect chains & loops", () => {
  it("reports one chain on the head only when ≥ 2 redirects precede content", () => {
    const pages = [
      slim("https://e.com/chain-1", { statusCode: 301, redirectUrl: "https://e.com/chain-2" }),
      slim("https://e.com/chain-2", { statusCode: 301, redirectUrl: "https://e.com/" }),
      slim("https://e.com/"),
      slim("https://e.com/single", { statusCode: 301, redirectUrl: "https://e.com/" }),
    ];
    const issues = findRedirectChainsAndLoops(pages);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueType: "redirect-chain", pageUrl: "https://e.com/chain-1", details: { hops: ["https://e.com/chain-1", "https://e.com/chain-2", "https://e.com/"], finalUrl: "https://e.com/" } });
  });
  it("detects self-redirect loops and headless cycles, not trailing-slash redirects", () => {
    const issues = findRedirectChainsAndLoops([
      slim("https://e.com/loop", { statusCode: 302, redirectUrl: "https://e.com/loop" }),
      slim("https://e.com/a", { statusCode: 301, redirectUrl: "https://e.com/b" }),
      slim("https://e.com/b", { statusCode: 301, redirectUrl: "https://e.com/a" }),
      slim("https://e.com/trailing-slash", { statusCode: 301, redirectUrl: "https://e.com/trailing-slash/" }),
      slim("https://e.com/trailing-slash/"),
    ]);
    expect(issues.map((i) => i.issueType)).toEqual(["redirect-loop", "redirect-loop"]);
    expect(issues.map((i) => i.pageUrl).sort()).toEqual(["https://e.com/a", "https://e.com/loop"]);
  });
  it("reports loops reached from a head", () => {
    const issues = findRedirectChainsAndLoops([
      slim("https://e.com/start", { statusCode: 301, redirectUrl: "https://e.com/x" }),
      slim("https://e.com/x", { statusCode: 301, redirectUrl: "https://e.com/y" }),
      slim("https://e.com/y", { statusCode: 301, redirectUrl: "https://e.com/x" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueType: "redirect-loop", pageUrl: "https://e.com/start" });
  });
});

describe("link graph checks", () => {
  const g = (url: string, targets: string[], o: Partial<LinkGraphPage> = {}): LinkGraphPage => ({ id: url, url, statusCode: 200, fetchClass: "ok", redirectUrl: null, internalTargets: targets, ...o });
  const pages = [
    g("https://e.com/", ["https://e.com/a", "https://e.com/missing", "https://e.com/blocked", "https://e.com/"]),
    g("https://e.com/a", ["https://e.com/missing", "https://e.com/a"]),
    g("https://e.com/missing", [], { statusCode: 404 }),
    g("https://e.com/blocked", [], { statusCode: 403, fetchClass: "blocked" }),
    g("https://e.com/orphan", []),
    g("https://e.com/self-only", ["https://e.com/self-only"]),
    g("https://e.com/redirected-to", []),
    g("https://e.com/r", [], { statusCode: 301, redirectUrl: "https://e.com/redirected-to" }),
  ];
  it("broken internal links: one per (source, target), blocked targets excluded", () => {
    const issues = findBrokenInternalLinks(pages);
    expect(issues.map((i) => `${i.pageUrl} -> ${String(i.details?.targetUrl)}`).sort()).toEqual([
      "https://e.com/ -> https://e.com/missing",
      "https://e.com/a -> https://e.com/missing",
    ]);
    expect(issues[0]!.dedupeKey).toBe("https://e.com/missing");
  });
  it("orphans: live pages without inbound links from other pages or redirects", () => {
    expect(findOrphanPages(pages, "https://e.com/").map((i) => i.pageUrl).sort()).toEqual(["https://e.com/orphan", "https://e.com/self-only"]);
  });
  it("inlink counts ignore self links", () => {
    const c = countInlinks(pages);
    expect(c.get("https://e.com/missing")).toBe(2);
    expect(c.get("https://e.com/self-only")).toBeUndefined();
  });
});
