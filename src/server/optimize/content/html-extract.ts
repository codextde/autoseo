import * as cheerio from "cheerio";

/**
 * Converts a fetched HTML page into a markdown approximation of its main content plus its
 * metadata and JSON-LD, so it can be scored with the same AEO function as drafts.
 */
export type ExtractedPage = {
  url: string;
  title: string;
  h1: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonical: string | null;
  lang: string | null;
  slug: string;
  markdown: string;
  jsonLd: string | null;
  jsonLdTypes: string[];
  faqs: Array<{ question: string; answer: string }>;
  links: { internal: number; external: number };
  wordCount: number;
};

/** Minimal structural view of htmlparser2/domhandler nodes (not re-exported by cheerio). */
type AnyNode = { type: string; data?: string; tagName?: string; children?: AnyNode[] };
type Element = AnyNode & { tagName: string; children: AnyNode[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEl = (n: AnyNode) => n as any;

const DROP = "script,style,noscript,template,svg,iframe,form,nav,footer,header,aside,button,[role=navigation],[aria-hidden=true],.cookie,.cookies,#cookie,.newsletter,.breadcrumb,.breadcrumbs";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function extractPage(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);
  const u = new URL(url);

  const jsonLdBlocks: unknown[] = [];
  const jsonLdTypes = new Set<string>();
  const faqs: Array<{ question: string; answer: string }> = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      jsonLdBlocks.push(parsed);
      const visit = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(visit);
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        const t = o["@type"];
        const types = Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
        types.forEach((x) => jsonLdTypes.add(x));
        if (types.includes("FAQPage") && Array.isArray(o.mainEntity)) {
          for (const q of o.mainEntity as Array<Record<string, unknown>>) {
            const answer = (q.acceptedAnswer as Record<string, unknown> | undefined)?.text;
            if (typeof q.name === "string" && typeof answer === "string") faqs.push({ question: clean(q.name), answer: clean(cheerio.load(answer).text()) });
          }
        }
        if (o["@graph"]) visit(o["@graph"]);
      };
      visit(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  });

  const metaTitle = clean($("title").first().text()) || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href") ?? null;
  const lang = $("html").attr("lang") ?? null;

  $("body").find(DROP).remove();
  // Pick the main content container: the largest of main/article/role=main that holds a meaningful
  // share of the page text (a small <article> card must not win over the body).
  const bodyLen = $("body").text().replace(/\s+/g, " ").length || 1;
  let root = $("body");
  let best = 0;
  $("main, [role=main], article, #content, #main-content").each((_, el) => {
    const len = $(el).text().replace(/\s+/g, " ").length;
    if (len > best && len >= bodyLen * 0.4) {
      best = len;
      root = $(el);
    }
  });

  let internal = 0;
  let external = 0;
  const lines: string[] = [];
  const inline = (el: AnyNode): string => {
    if (el.type === "text") return (el as unknown as { data: string }).data;
    if (el.type !== "tag") return "";
    const tag = (el as Element).tagName.toLowerCase();
    const inner = ((el as Element).children ?? []).map(inline).join("");
    if (tag === "a") {
      const href = $(asEl(el)).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return inner;
      try {
        const abs = new URL(href, url);
        if (abs.hostname === u.hostname) internal++;
        else external++;
        return abs.hostname === u.hostname ? inner : `[${clean(inner)}](${abs.toString()})`;
      } catch {
        return inner;
      }
    }
    if (tag === "strong" || tag === "b") return clean(inner) ? `**${clean(inner)}**` : "";
    if (tag === "em" || tag === "i") return clean(inner) ? `*${clean(inner)}*` : "";
    if (tag === "br") return " ";
    return inner;
  };

  const walk = (el: AnyNode) => {
    if (el.type !== "tag") return;
    const node = el as Element;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = clean($(asEl(node)).text());
      if (text) lines.push(`${"#".repeat(Number(tag[1]))} ${text}`, "");
      return;
    }
    if (tag === "p") {
      const text = clean(node.children.map(inline).join(""));
      if (text) lines.push(text, "");
      return;
    }
    if (tag === "ul" || tag === "ol") {
      let i = 1;
      $(asEl(node))
        .children("li")
        .each((_, li) => {
          const text = clean((li as unknown as Element).children.filter((c) => !(c.type === "tag" && ["ul", "ol"].includes((c as Element).tagName))).map(inline).join(""));
          if (text) lines.push(tag === "ol" ? `${i++}. ${text}` : `- ${text}`);
        });
      lines.push("");
      return;
    }
    if (tag === "table") {
      const rows: string[][] = [];
      $(asEl(node))
        .find("tr")
        .each((_, tr) => {
          const cells = $(tr)
            .children("th,td")
            .map((__, c) => clean($(c).text()).replace(/\|/g, "/"))
            .get();
          if (cells.length) rows.push(cells);
        });
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
        lines.push(`| ${pad(rows[0]!).join(" | ")} |`, `|${" --- |".repeat(width)}`);
        for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
        lines.push("");
      }
      return;
    }
    if (tag === "blockquote") {
      const text = clean($(asEl(node)).text());
      if (text) lines.push(`> ${text}`, "");
      return;
    }
    if (tag === "pre") {
      lines.push("```", $(asEl(node)).text().trim(), "```", "");
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of ((root.get(0) as unknown as AnyNode | undefined)?.children ?? [])) walk(child);

  const markdown = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const h1 = clean($("h1").first().text()) || null;
  const slug = u.pathname.split("/").filter(Boolean).pop() ?? "";
  return {
    url,
    title: h1 ?? metaTitle ?? u.hostname,
    h1,
    metaTitle,
    metaDescription,
    canonical,
    lang,
    slug,
    markdown,
    jsonLd: jsonLdBlocks.length ? JSON.stringify(jsonLdBlocks.length === 1 ? jsonLdBlocks[0] : jsonLdBlocks, null, 2) : null,
    jsonLdTypes: [...jsonLdTypes],
    faqs,
    links: { internal, external },
    wordCount: markdown.split(/\s+/).filter(Boolean).length,
  };
}
