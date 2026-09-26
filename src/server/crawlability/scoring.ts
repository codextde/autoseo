/**
 * AI crawlability score (0–100) + findings with concrete fixes. Pure.
 *
 * Weights: robots.txt access 30 · HTTP access for bot user agents 20 · raw-HTML rendering 15 ·
 * llms.txt 10 · meta robots / X-Robots-Tag 10 · sitemap 5 · structured data 5 · canonical 3 ·
 * performance (TTFB / HTML weight) 2. Bots are weighted by purpose (AI search & user-triggered ×3,
 * training ×1, SEO tools ×0).
 */
import { botWeight } from "./bots";
import type { CategoryScore, CrawlabilityResult, Finding, FindingCategory } from "./types";

export const CATEGORY_MAX: Record<FindingCategory, { label: string; max: number }> = {
  robots: { label: "robots.txt access", max: 30 },
  bots: { label: "Bot HTTP access", max: 20 },
  rendering: { label: "Server-side rendering", max: 15 },
  llms: { label: "llms.txt", max: 10 },
  meta: { label: "Meta robots", max: 10 },
  sitemap: { label: "Sitemap", max: 5 },
  "structured-data": { label: "Structured data", max: 5 },
  canonical: { label: "Canonical", max: 3 },
  performance: { label: "TTFB & weight", max: 2 },
};

type Base = Omit<CrawlabilityResult, "categories" | "findings">;

function weightedShare(items: Array<{ weight: number; value: number }>): number {
  const total = items.reduce((a, i) => a + i.weight, 0);
  if (!total) return 1;
  return items.reduce((a, i) => a + i.weight * i.value, 0) / total;
}

/** robots.txt snippet that re-allows the given bots while keeping the site's wildcard exclusions. */
export function buildRobotsAllowSnippet(base: Pick<Base, "robots">, tokens: string[]): string {
  // Paths the site already excludes for everyone (except a full "/" block) stay excluded, because a
  // crawler with its own group no longer reads the `*` group.
  const out: string[] = [];
  let inWildcard = false;
  let lastWasAgent = false;
  for (const l of (base.robots.raw ?? "").split(/\r?\n/)) {
    const line = l.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      inWildcard = lastWasAgent ? inWildcard || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inWildcard && field === "disallow" && value && value !== "/") out.push(`Disallow: ${value}`);
  }
  const wildcardDisallows = [...new Set(out)].slice(0, 30);
  return ["# Allow AI search engines and assistants to read your site", ...tokens.map((t) => `User-agent: ${t}`), "Allow: /", ...wildcardDisallows, ""].join("\n");
}

export function scoreCrawlability(base: Base): { score: number; categories: CategoryScore[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const points: Record<FindingCategory, number> = {
    robots: 0,
    bots: 0,
    rendering: 0,
    llms: 0,
    meta: 0,
    sitemap: 0,
    "structured-data": 0,
    canonical: 0,
    performance: 0,
  };
  const home = base.pages[0];
  const scoredBots = base.bots.filter((b) => botWeight(b.purpose) > 0);

  /* robots.txt */
  if (base.robots.unreachable) {
    findings.push({
      id: "robots-unreachable",
      severity: "critical",
      category: "robots",
      title: `robots.txt returns HTTP ${base.robots.status}`,
      description:
        "When robots.txt answers with a server error, RFC 9309 tells crawlers to assume the whole site is disallowed. AI crawlers will skip your site until it responds normally.",
      fix: "Serve robots.txt with HTTP 200 (or 404 if you have none). Check your CDN/WAF rules for /robots.txt.",
      affected: [base.robots.url],
    });
  } else if (!base.robots.found) {
    findings.push({
      id: "robots-missing",
      severity: "info",
      category: "robots",
      title: "No robots.txt found",
      description: "Without a robots.txt everything is allowed — fine for AI access, but you lose a central place to point crawlers to your sitemap and llms.txt.",
      fix: "Add a robots.txt that allows AI crawlers and lists your sitemap.",
      snippet: { language: "robots", filename: "robots.txt", code: `User-agent: *\nAllow: /\n\nSitemap: ${base.origin}/sitemap.xml\n` },
    });
  }
  const robotsShare = weightedShare(
    scoredBots.map((b) => ({
      weight: botWeight(b.purpose),
      value: b.robots.status === "allowed" ? 1 : b.robots.status === "partial" ? Math.max(0.25, 1 - b.robots.blockedShare) : 0,
    })),
  );
  points.robots = base.robots.unreachable ? 0 : 30 * robotsShare;
  const blockedSearch = scoredBots.filter((b) => b.robots.status === "blocked" && b.purpose !== "training");
  const blockedTraining = scoredBots.filter((b) => b.robots.status === "blocked" && b.purpose === "training");
  const partialBots = scoredBots.filter((b) => b.robots.status === "partial");
  if (!base.robots.unreachable && blockedSearch.length) {
    findings.push({
      id: "robots-blocks-ai-search",
      severity: "critical",
      category: "robots",
      title: `robots.txt blocks ${blockedSearch.length} AI search/assistant crawler${blockedSearch.length > 1 ? "s" : ""}`,
      description: `${blockedSearch.map((b) => b.name).join(", ")} cannot read your pages, so answers in ChatGPT, Claude, Perplexity & co. can't cite or recommend them.`,
      fix: "Add an explicit Allow group for these crawlers to robots.txt (keeps your existing exclusions).",
      snippet: { language: "robots", filename: "robots.txt", code: buildRobotsAllowSnippet(base, blockedSearch.map((b) => b.token)) },
      affected: blockedSearch.map((b) => `${b.token} — ${b.robots.rule ?? "blocked"}${b.robots.ruleLine ? ` (line ${b.robots.ruleLine})` : ""}`),
    });
  }
  if (!base.robots.unreachable && blockedTraining.length) {
    findings.push({
      id: "robots-blocks-training",
      severity: "warning",
      category: "robots",
      title: `robots.txt blocks ${blockedTraining.length} AI training crawler${blockedTraining.length > 1 ? "s" : ""}`,
      description: `${blockedTraining.map((b) => b.name).join(", ")} are excluded. That's a legitimate choice, but models trained without your content know less about your brand.`,
      fix: "If you want your brand represented in model knowledge, allow the training crawlers too.",
      snippet: { language: "robots", filename: "robots.txt", code: buildRobotsAllowSnippet(base, blockedTraining.map((b) => b.token)) },
      affected: blockedTraining.map((b) => `${b.token} — ${b.robots.rule ?? "blocked"}`),
    });
  }
  if (partialBots.length) {
    findings.push({
      id: "robots-partial",
      severity: partialBots.some((b) => b.robots.blockedShare >= 0.2 && b.purpose !== "training") ? "warning" : "info",
      category: "robots",
      title: `${partialBots.length} AI crawler${partialBots.length > 1 ? "s are" : " is"} blocked from part of your content`,
      description: "Disallow rules match pages from your sitemap or the checked key pages. Make sure product, pricing, docs and blog content stays accessible.",
      affected: partialBots.map((b) => `${b.token} — ${Math.round(b.robots.blockedShare * 100)}% of ${b.robots.sampleSize} sampled URLs blocked (${b.robots.rule ?? "partial"})`),
    });
  }
  if (!base.robots.unreachable && !blockedSearch.length && !blockedTraining.length) {
    findings.push({ id: "robots-ok", severity: "pass", category: "robots", title: "robots.txt allows all major AI crawlers", description: "No AI search, assistant or training crawler is blocked." });
  }
  const crawlDelayed = scoredBots.filter((b) => (b.robots.crawlDelay ?? 0) >= 10);
  if (crawlDelayed.length) {
    findings.push({
      id: "robots-crawl-delay",
      severity: "info",
      category: "robots",
      title: "High Crawl-delay for AI crawlers",
      description: `A Crawl-delay of ${crawlDelayed[0]!.robots.crawlDelay}s slows down how fast crawlers can refresh your content.`,
      affected: crawlDelayed.map((b) => b.token),
    });
  }
  if (base.robots.warnings.length) {
    findings.push({
      id: "robots-syntax",
      severity: "info",
      category: "robots",
      title: `${base.robots.warnings.length} robots.txt line${base.robots.warnings.length > 1 ? "s" : ""} could not be interpreted`,
      description: "Crawlers ignore invalid lines, which can silently change who is allowed.",
      affected: base.robots.warnings.slice(0, 10).map((w) => `Line ${w.line}: ${w.message}`),
    });
  }

  /* HTTP access per bot UA */
  const fetchBots = scoredBots.filter((b) => b.fetches);
  if (base.browserBlocked) {
    points.bots = 10;
    findings.push({
      id: "site-unreachable",
      severity: "warning",
      category: "bots",
      title: "The homepage did not load for our checker",
      description: `A regular browser request got ${home?.status ? `HTTP ${home.status}` : home?.error ?? "no response"}. Bot access could not be compared.`,
      fix: "Make sure the site is reachable from data-center IPs, or allowlist the checker in your WAF.",
    });
  } else {
    const share = weightedShare(
      fetchBots.map((b) => ({
        weight: botWeight(b.purpose),
        value: b.http.verdict === "ok" ? 1 : b.http.verdict === "different" ? 0.5 : b.http.verdict === "blocked" ? 0 : 0.75,
      })),
    );
    points.bots = 20 * share;
    const blocked = fetchBots.filter((b) => b.http.verdict === "blocked");
    const different = fetchBots.filter((b) => b.http.verdict === "different");
    if (blocked.length) {
      findings.push({
        id: "waf-blocks-bots",
        severity: blocked.some((b) => b.purpose !== "training") ? "critical" : "warning",
        category: "bots",
        title: `Server/WAF blocks ${blocked.length} AI crawler user agent${blocked.length > 1 ? "s" : ""}`,
        description:
          "Requests with these crawler user agents got an error or bot challenge while a browser got the page. Even if robots.txt allows them, they can't read your content. (Note: some WAFs only admit verified crawler IPs; real crawlers may fare better than this user-agent test.)",
        fix: "In your CDN/WAF (e.g. Cloudflare → Security → Bots, AI Crawl Control), allow verified AI crawlers instead of blocking or challenging them.",
        affected: blocked.map((b) => {
          const p = b.http.pages.find((x) => x.verdict === "blocked");
          return `${b.token} — ${p?.reason ?? "blocked"}`;
        }),
      });
    }
    if (different.length) {
      findings.push({
        id: "bots-get-different-content",
        severity: "warning",
        category: "bots",
        title: `${different.length} crawler${different.length > 1 ? "s receive" : " receives"} different content`,
        description: "These user agents were redirected elsewhere or received much less content than a browser (cloaking-like behaviour or bot-specific templates).",
        affected: different.map((b) => `${b.token} — ${b.http.pages.find((x) => x.verdict === "different")?.reason ?? ""}`),
      });
    }
    if (!blocked.length && !different.length) {
      findings.push({ id: "bots-ok", severity: "pass", category: "bots", title: "AI crawler user agents get the same pages as browsers", description: `Tested ${fetchBots.length} crawler user agents on ${Math.min(base.pages.length, 3)} page(s).` });
    }
  }

  /* Rendering */
  const analyzed = base.pages.filter((p) => p.signals);
  if (analyzed.length) {
    const share = analyzed.reduce((a, p) => a + (p.signals!.rendering.verdict === "ssr" ? 1 : p.signals!.rendering.verdict === "partial" ? 0.5 : 0), 0) / analyzed.length;
    points.rendering = 15 * share;
    const csr = analyzed.filter((p) => p.signals!.rendering.verdict === "csr");
    const partial = analyzed.filter((p) => p.signals!.rendering.verdict === "partial");
    if (csr.length) {
      const fw = csr[0]!.signals!.rendering.frameworks[0];
      findings.push({
        id: "rendering-csr",
        severity: "critical",
        category: "rendering",
        title: `${csr.length} page${csr.length > 1 ? "s render" : " renders"} content only with JavaScript`,
        description:
          "The raw HTML contains almost no text. Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) do not execute JavaScript, so they see an empty page.",
        fix: `Enable server-side rendering or static pre-rendering${fw ? ` (${fw} supports SSR/SSG)` : ""} so the main content, headings and links are in the initial HTML.`,
        affected: csr.map((p) => `${p.url} — ${p.signals!.wordCount} words in raw HTML${p.signals!.rendering.spaMarkers.length ? `, ${p.signals!.rendering.spaMarkers[0]}` : ""}`),
      });
    }
    if (partial.length) {
      findings.push({
        id: "rendering-partial",
        severity: "warning",
        category: "rendering",
        title: `${partial.length} page${partial.length > 1 ? "s have" : " has"} little server-rendered text`,
        description: "Part of the content seems to load client-side. AI crawlers may only see a fraction of it.",
        affected: partial.map((p) => `${p.url} — ${p.signals!.wordCount} words`),
      });
    }
    if (!csr.length && !partial.length) {
      findings.push({ id: "rendering-ok", severity: "pass", category: "rendering", title: "Content is server-rendered", description: "Key pages contain their text, headings and links in the raw HTML." });
    }
  }

  /* llms.txt */
  const llms = base.llms.txt;
  if (llms.present && llms.validation?.valid) {
    const hasLists = llms.validation.linkCount > 0;
    points.llms = hasLists ? 10 : 7;
    findings.push({
      id: hasLists ? "llms-ok" : "llms-no-lists",
      severity: llms.validation.warnings.length ? (hasLists ? "info" : "warning") : "pass",
      category: "llms",
      title: hasLists ? `llms.txt found (${llms.validation.linkCount} links)` : "llms.txt found, but it doesn't list your key pages",
      description: llms.validation.warnings.length ? llms.validation.warnings.join(" ") : "Your llms.txt follows the llmstxt.org format.",
      fix: hasLists ? undefined : "Add `## Sections` with `- [Page title](https://…): short note` links to your most important pages. Use the generator in the llms.txt tab.",
      affected: [llms.url],
    });
  } else if (llms.present) {
    points.llms = 3;
    findings.push({
      id: "llms-invalid",
      severity: "warning",
      category: "llms",
      title: "llms.txt has format problems",
      description: [...(llms.validation?.errors ?? []), ...(llms.validation?.warnings ?? [])].join(" "),
      fix: "Follow the llmstxt.org structure: `# Site name`, a `> summary`, then `## Sections` with `- [Title](https://url): notes` links. Use the generator in the llms.txt tab.",
      affected: [llms.url],
    });
  } else {
    findings.push({
      id: "llms-missing",
      severity: "warning",
      category: "llms",
      title: "No llms.txt",
      description: "llms.txt gives AI assistants a curated map of your most important pages in markdown. It's cheap to add and increasingly read by AI agents and coding assistants.",
      fix: "Publish /llms.txt at your domain root. Generate a draft from your sitemap in the llms.txt tab and review it.",
      affected: [llms.url],
    });
  }
  if (base.llms.full.present) {
    findings.push({ id: "llms-full", severity: "pass", category: "llms", title: "llms-full.txt found", description: `${Math.round(base.llms.full.bytes / 1024)} KB of full-text content for AI agents.` });
  }

  /* Meta robots / X-Robots-Tag */
  let meta = 10;
  const metaAffected = new Map<string, string[]>();
  for (const p of base.pages) {
    for (const d of p.directives) {
      const key = d.directive;
      const list = metaAffected.get(key) ?? [];
      list.push(`${p.url} — ${d.source}${d.scope !== "all" ? ` (${d.scope})` : ""}`);
      metaAffected.set(key, list);
    }
  }
  const hasAll = (dir: string) => base.pages.some((p) => p.directives.some((d) => d.directive === dir && d.scope === "all"));
  if (hasAll("noindex")) meta -= 10;
  if (metaAffected.has("noai") || metaAffected.has("noimageai")) meta -= 4;
  if (metaAffected.has("nosnippet") || metaAffected.has("max-snippet:0")) meta -= 4;
  points.meta = Math.max(0, meta);
  if (metaAffected.has("noindex")) {
    findings.push({
      id: "meta-noindex",
      severity: hasAll("noindex") ? "critical" : "warning",
      category: "meta",
      title: "Key pages are marked noindex",
      description: "noindex keeps pages out of search indexes that AI search products (Bing → ChatGPT/Copilot, Google → AI Overviews) rely on.",
      fix: 'Remove `noindex` from pages that should be found: `<meta name="robots" content="index, follow">`.',
      affected: metaAffected.get("noindex"),
    });
  }
  const aiDirectives = ["noai", "noimageai", "nosnippet", "max-snippet:0"].filter((d) => metaAffected.has(d));
  if (aiDirectives.length) {
    findings.push({
      id: "meta-noai",
      severity: "warning",
      category: "meta",
      title: `AI-restricting directives found: ${aiDirectives.join(", ")}`,
      description: "nosnippet / max-snippet:0 stop search engines (incl. Google AI Overviews and Bing/Copilot) from quoting your content; noai / noimageai signal that AI usage is not allowed.",
      fix: "Remove these directives from pages you want AI answers to cite, e.g. `<meta name=\"robots\" content=\"index, follow, max-snippet:-1, max-image-preview:large\">`.",
      snippet: { language: "html", code: '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">' },
      affected: aiDirectives.flatMap((d) => metaAffected.get(d) ?? []),
    });
  }
  if (!metaAffected.size) {
    findings.push({ id: "meta-ok", severity: "pass", category: "meta", title: "No blocking meta robots or X-Robots-Tag directives", description: "No noindex, noai or nosnippet on the checked pages." });
  }

  /* Sitemap */
  if (base.sitemap.found && base.sitemap.totalUrls > 0) {
    points.sitemap = 5;
    const listed = base.robots.sitemaps.length > 0;
    findings.push({
      id: listed ? "sitemap-ok" : "sitemap-not-in-robots",
      severity: listed ? "pass" : "info",
      category: "sitemap",
      title: listed ? `Sitemap found (${base.sitemap.totalUrls} URLs)` : "Sitemap is not referenced in robots.txt",
      description: listed ? "Crawlers can discover all pages via the sitemap referenced in robots.txt." : "Add a Sitemap line so every crawler finds it without guessing.",
      snippet: listed ? undefined : { language: "robots", filename: "robots.txt", code: `Sitemap: ${base.sitemap.docs.find((d) => d.ok)?.url ?? `${base.origin}/sitemap.xml`}\n` },
    });
  } else if (base.sitemap.found) {
    points.sitemap = 2;
    findings.push({ id: "sitemap-empty", severity: "warning", category: "sitemap", title: "Sitemap found but contains no URLs", description: "The sitemap could not be parsed or is empty.", affected: base.sitemap.docs.map((d) => `${d.url} — ${d.error ?? "empty"}`) });
  } else {
    findings.push({
      id: "sitemap-missing",
      severity: "warning",
      category: "sitemap",
      title: "No XML sitemap found",
      description: "Neither robots.txt nor /sitemap.xml points to a sitemap. Crawlers have to discover pages via links only.",
      fix: "Publish an XML sitemap and reference it in robots.txt.",
      snippet: { language: "robots", filename: "robots.txt", code: `Sitemap: ${base.origin}/sitemap.xml\n` },
    });
  }

  /* Structured data */
  const homeSignals = home?.signals;
  if (homeSignals) {
    let sd = 0;
    if (homeSignals.jsonLd.count > 0) sd += 3;
    const types = homeSignals.jsonLd.types.map((t) => t.toLowerCase());
    if (types.some((t) => ["organization", "corporation", "localbusiness", "website", "store", "onlinestore", "brand"].includes(t))) sd += 2;
    if (homeSignals.jsonLd.invalid > 0) sd -= 1;
    points["structured-data"] = Math.max(0, sd);
    if (homeSignals.jsonLd.count === 0) {
      findings.push({
        id: "sd-missing",
        severity: "warning",
        category: "structured-data",
        title: "No JSON-LD structured data on the homepage",
        description: "Organization / WebSite schema helps AI systems resolve your brand entity (name, logo, social profiles, contact).",
        fix: "Add Organization + WebSite JSON-LD to the homepage.",
        snippet: {
          language: "html",
          code: `<script type="application/ld+json">\n${JSON.stringify(
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "Organization", "@id": `${base.origin}/#org`, name: homeSignals.title.split(/[|–-]/)[0]?.trim() || new URL(base.origin).hostname, url: base.origin, logo: `${base.origin}/logo.png`, sameAs: [] },
                { "@type": "WebSite", "@id": `${base.origin}/#website`, url: base.origin, name: homeSignals.title.split(/[|–-]/)[0]?.trim() || new URL(base.origin).hostname, publisher: { "@id": `${base.origin}/#org` } },
              ],
            },
            null,
            2,
          )}\n</script>`,
        },
      });
    } else {
      findings.push({
        id: homeSignals.jsonLd.invalid ? "sd-invalid" : "sd-ok",
        severity: homeSignals.jsonLd.invalid ? "warning" : "pass",
        category: "structured-data",
        title: homeSignals.jsonLd.invalid ? `${homeSignals.jsonLd.invalid} JSON-LD block(s) contain invalid JSON` : `Structured data found: ${homeSignals.jsonLd.types.slice(0, 6).join(", ") || "JSON-LD"}`,
        description: homeSignals.jsonLd.invalid ? "Invalid JSON-LD is ignored by all consumers." : "The homepage exposes machine-readable entity data.",
      });
    }
  }

  /* Canonical */
  const canonicalIssues: string[] = [];
  let canon = 3;
  for (const p of base.pages.filter((x) => x.signals)) {
    if (p.canonical.conflict) {
      canonicalIssues.push(`${p.url} — HTML and Link header canonicals differ`);
      canon -= 1.5;
    } else if (!p.canonical.href) {
      canonicalIssues.push(`${p.url} — no canonical`);
      canon -= 0.5;
    } else if (p.canonical.self === false) {
      canonicalIssues.push(`${p.url} — canonical points to ${p.canonical.resolved}`);
      canon -= p === home ? 2 : 0.5;
    }
  }
  points.canonical = Math.max(0, canon);
  if (canonicalIssues.length) {
    findings.push({
      id: "canonical-issues",
      severity: "info",
      category: "canonical",
      title: "Canonical signals could be clearer",
      description: "Self-referencing canonicals tell AI and search crawlers which URL to cite.",
      fix: 'Add `<link rel="canonical" href="https://…/this-page">` pointing to the page\'s own preferred URL.',
      affected: canonicalIssues,
    });
  }

  /* Performance */
  if (home && home.status && home.status < 400) {
    let perf = 0;
    if ((home.ttfbMs ?? 9999) < 800) perf += 1;
    if (home.bytes < 1024 * 1024) perf += 1;
    points.performance = perf;
    if ((home.ttfbMs ?? 0) >= 800) {
      findings.push({
        id: "slow-ttfb",
        severity: (home.ttfbMs ?? 0) >= 2000 ? "warning" : "info",
        category: "performance",
        title: `Slow time to first byte (${home.ttfbMs} ms)`,
        description: "User-triggered AI fetchers (ChatGPT-User, Perplexity-User) have short timeouts; slow responses can make them give up.",
        fix: "Cache HTML at the edge / use static generation for key pages.",
      });
    }
    if (home.bytes >= 1024 * 1024) {
      findings.push({ id: "heavy-html", severity: "info", category: "performance", title: `Large HTML document (${Math.round(home.bytes / 1024)} KB)`, description: "Crawlers may truncate very large documents; inline scripts and data inflate the HTML." });
    }
    if (!home.contentEncoding && home.bytes > 50 * 1024) {
      findings.push({ id: "no-compression", severity: "info", category: "performance", title: "HTML is served without compression", description: "Enable gzip or brotli to reduce transfer size for crawlers." });
    }
  }

  const categories: CategoryScore[] = (Object.keys(CATEGORY_MAX) as FindingCategory[]).map((key) => ({
    key,
    label: CATEGORY_MAX[key].label,
    max: CATEGORY_MAX[key].max,
    score: Math.round(Math.min(points[key], CATEGORY_MAX[key].max) * 10) / 10,
  }));
  const score = Math.round(categories.reduce((a, c) => a + c.score, 0));
  const order = { critical: 0, warning: 1, info: 2, pass: 3 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score: Math.max(0, Math.min(100, score)), categories, findings };
}
