import { describe, expect, it } from "vitest";
import { destinationChanged, getCatalogEntry, INTEGRATIONS, isInlineTokenProvider, resolveIntegrationHref } from "./integrations-catalog";

describe("integrations catalog", () => {
  it("has unique keys and resolvable setup links", () => {
    const keys = INTEGRATIONS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(resolveIntegrationHref(getCatalogEntry("linear")!.setupHref, "prj_x")).toBe("/p/prj_x/tasks?connect=linear");
    expect(isInlineTokenProvider(getCatalogEntry("matomo")!)).toBe(true);
    expect(isInlineTokenProvider(getCatalogEntry("linear")!)).toBe(false);
  });

  it("detects destination changes that must discard stored secrets", () => {
    const matomo = getCatalogEntry("matomo")!;
    const stored = { url: "https://analytics.example.com", siteId: "1" };
    expect(destinationChanged(matomo, stored, { url: "https://analytics.example.com/", siteId: "2" })).toBe(false);
    expect(destinationChanged(matomo, stored, { url: "https://attacker.example.net", siteId: "1" })).toBe(true);
    expect(destinationChanged(matomo, stored, { siteId: "1" })).toBe(true);
    expect(destinationChanged(matomo, null, { url: "https://x.test" })).toBe(false);
    const piwik = getCatalogEntry("piwik_pro")!;
    expect(destinationChanged(piwik, { accountUrl: "https://acme.piwik.pro" }, { accountUrl: "https://evil.piwik.pro" })).toBe(true);
    // Bing's API host is fixed — the site URL is not a secret destination.
    expect(destinationChanged(getCatalogEntry("bing_webmaster")!, { siteUrl: "https://a.test/" }, { siteUrl: "https://b.test/" })).toBe(false);
  });
});
