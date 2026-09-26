/**
 * Citation URL normalization + content-type / ownership classification of cited sources.
 * Pure module (no server imports) so it can be unit tested.
 */
import type { SourceContentType } from "@/server/db/schema/ai";
import { domainMatches } from "./brand-match";

const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "dclid",
  "yclid",
  "srsltid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "spm",
  "si",
  "trk",
]);

/** Canonical form of a cited URL (http(s) only, no tracking params/fragment, no www.). */
export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || TRACKING_PARAMS.has(k)) url.searchParams.delete(key);
  }
  url.protocol = "https:";
  let out = url.toString();
  if (url.pathname !== "/" && out.endsWith("/") && !url.search) out = out.slice(0, -1);
  if (url.pathname === "/" && !url.search) out = out.replace(/\/$/, "");
  return out.length > 2048 ? null : out;
}

export function urlDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const has = (list: string[], domain: string) => list.some((d) => domainMatches(domain, d));

const VIDEO = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "dailymotion.com", "twitch.tv"];
const UGC = [
  "reddit.com",
  "quora.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "threads.net",
  "trustpilot.com",
  "tripadvisor.com",
  "yelp.com",
  "g2.com",
  "capterra.com",
  "producthunt.com",
  "medium.com",
  "substack.com",
];
const FORUM = ["stackoverflow.com", "stackexchange.com", "gutefrage.net", "discourse.org", "hackernews.com", "news.ycombinator.com"];
const REFERENCE = ["wikipedia.org", "wikidata.org", "wikihow.com", "britannica.com", "investopedia.com", "dictionary.com", "merriam-webster.com", "duden.de"];
const RETAIL = [
  "amazon.com",
  "amazon.de",
  "amazon.co.uk",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.nl",
  "amazon.ca",
  "ebay.com",
  "ebay.de",
  "ebay.co.uk",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "etsy.com",
  "aliexpress.com",
  "alibaba.com",
  "temu.com",
  "otto.de",
  "idealo.de",
  "idealo.co.uk",
  "geizhals.de",
  "billiger.de",
  "zalando.de",
  "zalando.com",
  "mediamarkt.de",
  "saturn.de",
  "kaufland.de",
  "galaxus.de",
  "galaxus.ch",
  "digitec.ch",
  "bol.com",
  "cdiscount.com",
  "fnac.com",
  "argos.co.uk",
  "currys.co.uk",
  "costco.com",
  "homedepot.com",
  "lowes.com",
  "ikea.com",
  "obi.de",
  "hornbach.de",
  "bauhaus.info",
  "toom.de",
  "lidl.de",
  "aldi-onlineshop.de",
  "shop.app",
];
const NEWS = [
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "reuters.com",
  "apnews.com",
  "theguardian.com",
  "bloomberg.com",
  "cnbc.com",
  "forbes.com",
  "businessinsider.com",
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "engadget.com",
  "arstechnica.com",
  "spiegel.de",
  "zeit.de",
  "faz.net",
  "welt.de",
  "sueddeutsche.de",
  "handelsblatt.com",
  "tagesschau.de",
  "n-tv.de",
  "focus.de",
  "t-online.de",
  "stern.de",
  "heise.de",
  "golem.de",
  "br.de",
  "ndr.de",
  "wdr.de",
  "swr.de",
  "mdr.de",
  "zdf.de",
  "lemonde.fr",
  "lefigaro.fr",
  "elpais.com",
  "corriere.it",
  "nzz.ch",
  "derstandard.at",
];
const TEST_DOMAINS = ["test.de", "rtings.com", "chip.de", "computerbild.de", "connect.de", "techradar.com", "tomsguide.com", "pcmag.com", "cnet.com"];

const TEST_RE = /\b(test|tests|tested|testbericht|im test|vergleichstest|testsieger|review|reviews|hands[- ]on|erfahrungen|erfahrungsbericht)\b/;
const LISTICLE_RE =
  /\b(best|top[- ]?\d+|top ten|die besten|beste[nrs]?|bestenliste|alternatives?|alternativen|vs\.?|versus|comparison|compared|vergleich|ranking|rangliste)\b/;
const GUIDE_RE = /\b(buying guide|buyer'?s guide|kaufberatung|kaufratgeber|ratgeber|guide|how to choose|worauf achten|what to look for|faq)\b/;
const DOCS_RE = /(^|\.)(docs|developer|developers|dev|help|support|kb|knowledge|manual|api)\./;
const DOCS_PATH_RE = /\/(docs?|documentation|manual|handbuch|help|support|kb|knowledge-base|api-reference|faq)(\/|$)/;
const FORUM_RE = /(^|\.)(forum|forums|community|board|boards|discuss)\./;
const FORUM_PATH_RE = /\/(forum|forums|thread|threads|community|discussion|discussions|topic|t)\//;
const SHOP_PATH_RE = /\/(shop|store|product|products|produkt|produkte|p|dp|item|artikel|cart|kaufen)\//;
const NEWS_PATH_RE = /\/(news|nachrichten|article|artikel|politik|wirtschaft)\/|\/20\d\d\/\d{1,2}\//;
const ARTICLE_PATH_RE = /\/(blog|blogs|magazin|magazine|ratgeber|wissen|article|articles|post|posts|insights|resources|learn)\//;

export type Ownership = "own" | "competitor" | "third_party";

/** Heuristic content type of a cited page (domain, path and title). */
export function classifySource(input: { url: string; domain: string; title?: string | null; ownership: Ownership }): SourceContentType {
  const { domain, ownership } = input;
  let path = "";
  try {
    path = decodeURIComponent(new URL(input.url).pathname.toLowerCase());
  } catch {
    path = "";
  }
  const words = `${path.replace(/[/_-]+/g, " ")} ${(input.title ?? "").toLowerCase()}`;

  if (has(VIDEO, domain)) return "video";
  if (has(FORUM, domain) || FORUM_RE.test(domain) || FORUM_PATH_RE.test(path)) return "forum";
  if (has(UGC, domain)) return "ugc";
  if (has(REFERENCE, domain) || /\.(gov|edu)(\.[a-z]{2})?$/.test(domain)) return "reference";
  if (ownership === "third_party" && (has(RETAIL, domain) || /(^|\.)shop\./.test(domain))) return "retail";
  if (DOCS_RE.test(`${domain}.`) || DOCS_PATH_RE.test(path)) return "docs";
  if (has(TEST_DOMAINS, domain) || TEST_RE.test(words)) return "test";
  if (LISTICLE_RE.test(words)) return "listicle";
  if (GUIDE_RE.test(words)) return "buying-guide";
  if (has(NEWS, domain)) return "news";
  if (ownership !== "third_party") return "brand";
  if (SHOP_PATH_RE.test(path)) return "retail";
  if (NEWS_PATH_RE.test(path)) return "news";
  if (ARTICLE_PATH_RE.test(path) || path.split("/").filter(Boolean).length >= 1) return "article";
  return "other";
}

/** Own / competitor / third-party ownership of a cited domain. */
export function sourceOwnership(
  domain: string,
  own: string[],
  competitors: { id: string; domains: string[] }[],
): { ownership: Ownership; competitorId: string | null } {
  if (own.some((d) => domainMatches(domain, d))) return { ownership: "own", competitorId: null };
  for (const c of competitors) {
    if (c.domains.some((d) => domainMatches(domain, d))) return { ownership: "competitor", competitorId: c.id };
  }
  return { ownership: "third_party", competitorId: null };
}
