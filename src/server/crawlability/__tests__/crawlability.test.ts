import { describe, expect, it } from "vitest";
import { generateLlmsTxt, validateLlmsTxt } from "../llms-txt";
import { extractHtmlSignals, parseDirectives } from "../html-signals";
import { BOT_PROFILES, botWeight } from "../bots";
import { buildRobotsAllowSnippet } from "../scoring";
import { AI_BOTS } from "../../../lib/engines";

describe("llms.txt validation", () => {
  it("accepts the llmstxt.org structure", () => {
    const v = validateLlmsTxt(`# Acme\n\n> Acme makes rockets.\n\nSome notes.\n\n## Docs\n\n- [Quick start](https://acme.com/start): How to launch\n- [API](https://acme.com/api)\n\n## Optional\n\n- [Blog](https://acme.com/blog)\n`);
    expect(v.valid).toBe(true);
    expect(v.title).toBe("Acme");
    expect(v.summary).toBe("Acme makes rockets.");
    expect(v.sections.map((s) => s.title)).toEqual(["Docs", "Optional"]);
    expect(v.linkCount).toBe(3);
    expect(v.sections[0]!.links[0]).toEqual({ title: "Quick start", url: "https://acme.com/start", notes: "How to launch" });
    expect(v.warnings).toEqual([]);
  });
  it("flags HTML soft-404s, missing H1, relative links and missing link lists", () => {
    expect(validateLlmsTxt("<!doctype html><html></html>").valid).toBe(false);
    expect(validateLlmsTxt("hello", { contentType: "text/html; charset=utf-8" }).valid).toBe(false);
    const noH1 = validateLlmsTxt("## Docs\n- [A](https://a.com)");
    expect(noH1.valid).toBe(false);
    const rel = validateLlmsTxt("# A\n> s\n## Docs\n- [A](/relative)");
    expect(rel.warnings.join(" ")).toMatch(/relative URLs/);
    const inline = validateLlmsTxt("# A\n> s\n## Info\nSee [our docs](https://a.com/docs).");
    expect(inline.valid).toBe(true);
    expect(inline.inlineLinkCount).toBe(1);
    expect(inline.warnings.join(" ")).toMatch(/No link lists/);
  });
  it("generates a valid file grouped by site section", () => {
    const text = generateLlmsTxt({
      siteName: "Acme",
      summary: "Rockets for everyone",
      origin: "https://acme.com",
      pages: [
        { url: "https://acme.com/", title: "Acme – Home" },
        { url: "https://acme.com/about", title: "About us | Acme" },
        { url: "https://acme.com/products/falcon-rocket", title: "Falcon | Acme", description: "Our bestseller" },
        { url: "https://acme.com/products/eagle-rocket" },
        { url: "https://acme.com/de/products/adler" },
        { url: "https://acme.com/privacy", title: "Privacy" },
        { url: "https://acme.com/about/" },
      ],
    });
    const v = validateLlmsTxt(text);
    expect(v.valid).toBe(true);
    expect(v.title).toBe("Acme");
    expect(v.summary).toBe("Rockets for everyone");
    expect(v.sections.map((s) => s.title)).toEqual(["Main pages", "Products", "Optional"]);
    expect(text).toContain("- [Falcon](https://acme.com/products/falcon-rocket): Our bestseller");
    expect(text).toContain("[Eagle Rocket](https://acme.com/products/eagle-rocket)");
    expect(v.linkCount).toBe(6);
  });
});

describe("html signals", () => {
  it("detects SSR content, JSON-LD, robots metas and frameworks", () => {
    const html = `<html lang="en"><head><title>Acme</title><meta name="robots" content="index, max-snippet:0"><meta name="GPTBot" content="noindex">
      <link rel="canonical" href="https://acme.com/"><script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">{oops</script>
      <script id="__NEXT_DATA__" type="application/json">{}</script></head><body><h1>Acme</h1><p>${"word ".repeat(200)}</p><a href="/a">a</a></body></html>`;
    const s = extractHtmlSignals(html, "https://acme.com/");
    expect(s.rendering.verdict).toBe("ssr");
    expect(s.rendering.frameworks).toContain("Next.js");
    expect(s.jsonLd).toEqual({ count: 2, invalid: 1, types: ["Organization"] });
    expect(s.metaRobots).toEqual([
      { name: "robots", content: "index, max-snippet:0" },
      { name: "gptbot", content: "noindex" },
    ]);
    const d = parseDirectives(s.metaRobots, "noai, googlebot: nosnippet");
    expect(d).toEqual(
      expect.arrayContaining([
        { directive: "max-snippet:0", source: '<meta name="robots">', scope: "all" },
        { directive: "noindex", source: '<meta name="gptbot">', scope: "gptbot" },
        { directive: "noai", source: "X-Robots-Tag", scope: "all" },
        { directive: "nosnippet", source: "X-Robots-Tag", scope: "googlebot" },
      ]),
    );
  });
  it("flags JavaScript-only shells", () => {
    const s = extractHtmlSignals(`<html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>`, "https://x.com/");
    expect(s.rendering.verdict).toBe("csr");
    expect(s.rendering.spaMarkers).toContain("Empty #root container");
  });
  it("expands `none` into noindex + nofollow", () => {
    expect(parseDirectives([{ name: "robots", content: "none" }], null).map((d) => d.directive)).toEqual(["noindex", "nofollow"]);
  });
});

describe("bots & snippets", () => {
  it("covers every AI_BOTS token with a purpose weight", () => {
    expect(BOT_PROFILES.map((b) => b.token)).toEqual(AI_BOTS.map((b) => b.token));
    expect(botWeight("seo")).toBe(0);
    expect(botWeight("search")).toBeGreaterThan(botWeight("training"));
    expect(BOT_PROFILES.find((b) => b.token === "Google-Extended")!.userAgent).toBeNull();
    expect(BOT_PROFILES.find((b) => b.token === "GPTBot")!.userAgent).toMatch(/GPTBot/);
  });
  it("robots allow snippet keeps the wildcard exclusions", () => {
    const snippet = buildRobotsAllowSnippet(
      { robots: { raw: "User-agent: *\nDisallow: /admin\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /" } } as never,
      ["GPTBot", "OAI-SearchBot"],
    );
    expect(snippet).toContain("User-agent: GPTBot\nUser-agent: OAI-SearchBot\nAllow: /\nDisallow: /admin");
    expect(snippet).not.toMatch(/Disallow: \/\n/);
  });
});
