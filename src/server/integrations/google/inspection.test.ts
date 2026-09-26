import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationHttpError } from "../http";
import { inspectionApiError, inspectUrlRaw, normalizeInspection, sameCanonical, URL_INSPECTION_ENDPOINT } from "./inspection";

/** Shape documented at developers.google.com/webmaster-tools/v1/urlInspection.index/inspect. */
const FIXTURE = {
  inspectionResult: {
    inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=sc-domain:solakon.de&id=abc",
    indexStatusResult: {
      sitemap: ["https://solakon.de/sitemap.xml"],
      referringUrls: ["https://solakon.de/", "https://solakon.de/produkte"],
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      robotsTxtState: "ALLOWED",
      indexingState: "INDEXING_ALLOWED",
      lastCrawlTime: "2026-09-20T14:44:18Z",
      pageFetchState: "SUCCESSFUL",
      googleCanonical: "https://solakon.de/balkonkraftwerk",
      userCanonical: "https://solakon.de/balkonkraftwerk/",
      crawledAs: "MOBILE",
    },
    mobileUsabilityResult: {
      verdict: "PARTIAL",
      issues: [{ issueType: "USES_INCOMPATIBLE_PLUGINS", severity: "WARNING", message: "Uses incompatible plugins" }],
    },
    richResultsResult: {
      verdict: "PARTIAL",
      detectedItems: [
        {
          richResultType: "Product snippets",
          items: [{ name: "Solakon Balkonkraftwerk", issues: [{ issueMessage: "Missing field \"review\"", severity: "WARNING" }] }],
        },
        { richResultType: "Breadcrumbs", items: [{ name: "Unnamed item" }] },
      ],
    },
    ampResult: { verdict: "NEUTRAL", indexingState: "AMP_INDEXING_STATE_UNSPECIFIED" },
  },
};

describe("normalizeInspection", () => {
  it("maps the documented response shape", () => {
    const r = normalizeInspection(FIXTURE);
    expect(r.verdict).toBe("PASS");
    expect(r.coverageState).toBe("Submitted and indexed");
    expect(r.indexingState).toBe("INDEXING_ALLOWED");
    expect(r.crawledAs).toBe("MOBILE");
    expect(r.sitemaps).toEqual(["https://solakon.de/sitemap.xml"]);
    expect(r.referringUrls).toHaveLength(2);
    // Trailing-slash-only differences are not a canonical mismatch.
    expect(r.canonicalMismatch).toBe(false);
    expect(r.mobileUsability).toEqual({
      verdict: "PARTIAL",
      issues: [{ issueType: "USES_INCOMPATIBLE_PLUGINS", severity: "WARNING", message: "Uses incompatible plugins" }],
    });
    expect(r.richResults?.detectedItems[0]?.items[0]?.issues[0]?.issueMessage).toBe('Missing field "review"');
    expect(r.richResults?.detectedItems[1]?.items[0]?.issues).toEqual([]);
    expect(r.amp?.verdict).toBe("NEUTRAL");
    expect(r.inspectionResultLink).toContain("search.google.com");
  });

  it("flags a real canonical mismatch and tolerates sparse/unknown data", () => {
    const r = normalizeInspection({
      inspectionResult: { indexStatusResult: { verdict: "WEIRD", googleCanonical: "https://a.test/x", userCanonical: "https://a.test/y" } },
    });
    expect(r.verdict).toBe("VERDICT_UNSPECIFIED");
    expect(r.canonicalMismatch).toBe(true);
    expect(r.mobileUsability).toBeNull();
    expect(r.richResults).toBeNull();
    expect(r.sitemaps).toEqual([]);
    expect(normalizeInspection(null).verdict).toBe("VERDICT_UNSPECIFIED");
  });

  it("compares canonicals leniently", () => {
    expect(sameCanonical("https://A.test/p/", "https://a.test/p")).toBe(true);
    expect(sameCanonical("https://a.test/p?x=1", "https://a.test/p")).toBe(false);
  });
});

describe("inspectionApiError", () => {
  const e = (status: number, body: unknown) => new IntegrationHttpError("x", status, typeof body === "string" ? body : JSON.stringify(body));
  it("maps quota, permission and property errors", () => {
    expect(inspectionApiError(e(429, { error: { message: "Quota exceeded" } })).code).toBe("quota_exceeded");
    expect(inspectionApiError(e(403, { error: { message: "User does not have sufficient permission for site" } })).code).toBe("forbidden");
    expect(inspectionApiError(e(403, { error: { status: "PERMISSION_DENIED", message: "SERVICE_DISABLED" } })).message).toMatch(/not enabled/);
    expect(inspectionApiError(e(401, "")).code).toBe("reconnect_required");
    expect(inspectionApiError(e(400, { error: { message: "URL 'x' does not belong to property 'y'" } })).code).toBe("url_not_in_property");
    expect(inspectionApiError(e(500, "boom")).code).toBe("upstream_error");
    expect(inspectionApiError(new Error("network down")).message).toBe("network down");
  });
});

describe("inspectUrlRaw", () => {
  afterEach(() => vi.restoreAllMocks());
  it("POSTs inspectionUrl + siteUrl with the bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(FIXTURE), { status: 200 }));
    const r = await inspectUrlRaw("ya29.token", { siteUrl: "sc-domain:solakon.de", inspectionUrl: "https://solakon.de/balkonkraftwerk", languageCode: "de" });
    expect(r.verdict).toBe("PASS");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(URL_INSPECTION_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.token");
    expect(JSON.parse(String(init?.body))).toEqual({
      inspectionUrl: "https://solakon.de/balkonkraftwerk",
      siteUrl: "sc-domain:solakon.de",
      languageCode: "de",
    });
  });
  it("surfaces HTTP errors as IntegrationHttpError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 }));
    await expect(inspectUrlRaw("t", { siteUrl: "sc-domain:a.test", inspectionUrl: "https://a.test/" })).rejects.toBeInstanceOf(IntegrationHttpError);
  });
});

describe("readStoredInspection", () => {
  it("round-trips a normalized result stored in the history", async () => {
    const { readStoredInspection } = await import("./inspection");
    const normalized = normalizeInspection(FIXTURE);
    const stored = JSON.parse(JSON.stringify(normalized));
    expect(readStoredInspection(stored)).toEqual(normalized);
    // Raw API payloads are still accepted.
    expect(readStoredInspection(FIXTURE)).toEqual(normalized);
  });
});
