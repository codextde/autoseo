/**
 * Lighthouse sampling (port of open-seo `selectLighthouseSample`, strategy "auto"):
 * 2xx pages only; always the homepage/start URL; then the first page of each URL template;
 * capped at 10 URLs (each run on mobile + desktop = ≤ 20 checks).
 */
import { LIGHTHOUSE_SAMPLE_MAX_URLS } from "../registry";
import { canonicalUrlKey, detectUrlTemplate } from "../url-utils";

export interface LighthouseSamplePage {
  url: string;
  statusCode: number | null;
  isHtml?: boolean;
}

function canonicalUrlKeyWithoutTrailingSlash(url: string): string {
  const parsed = new URL(canonicalUrlKey(url));
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString();
}

export function selectLighthouseSample(
  pages: LighthouseSamplePage[],
  startUrl: string,
  strategy: "auto" | "none",
  maxUrls = LIGHTHOUSE_SAMPLE_MAX_URLS,
): string[] {
  if (strategy === "none") return [];
  const validPages = pages.filter((p) => p.statusCode !== null && p.statusCode >= 200 && p.statusCode < 300 && p.isHtml !== false);
  const selected = new Set<string>();
  const startKey = canonicalUrlKey(startUrl);
  const startPage =
    validPages.find((p) => canonicalUrlKey(p.url) === startKey) ??
    validPages.find((p) => canonicalUrlKeyWithoutTrailingSlash(p.url) === canonicalUrlKeyWithoutTrailingSlash(startUrl));
  if (startPage) selected.add(startPage.url);
  const templateGroups = new Map<string, LighthouseSamplePage>();
  if (startPage) templateGroups.set(detectUrlTemplate(new URL(startPage.url).pathname), startPage);
  for (const page of validPages) {
    if (selected.has(page.url)) continue;
    const template = detectUrlTemplate(new URL(page.url).pathname);
    if (!templateGroups.has(template)) templateGroups.set(template, page);
  }
  for (const [, page] of templateGroups) {
    if (selected.size >= maxUrls) break;
    selected.add(page.url);
  }
  return Array.from(selected);
}
