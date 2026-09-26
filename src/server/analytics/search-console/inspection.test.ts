import { describe, expect, it } from "vitest";
import { InspectionError, normalizeInspectUrl, urlBelongsToProperty, utcDayStart } from "./inspection";

describe("urlBelongsToProperty", () => {
  it("handles domain properties incl. subdomains and any protocol", () => {
    expect(urlBelongsToProperty("https://solakon.de/x", "sc-domain:solakon.de")).toBe(true);
    expect(urlBelongsToProperty("http://shop.solakon.de/", "sc-domain:solakon.de")).toBe(true);
    expect(urlBelongsToProperty("https://notsolakon.de/", "sc-domain:solakon.de")).toBe(false);
    expect(urlBelongsToProperty("https://solakon.de.evil.com/", "sc-domain:solakon.de")).toBe(false);
  });
  it("handles URL-prefix properties (protocol, host and path prefix)", () => {
    expect(urlBelongsToProperty("https://www.solakon.de/a/b", "https://www.solakon.de/")).toBe(true);
    expect(urlBelongsToProperty("http://www.solakon.de/a", "https://www.solakon.de/")).toBe(false);
    expect(urlBelongsToProperty("https://solakon.de/a", "https://www.solakon.de/")).toBe(false);
    expect(urlBelongsToProperty("https://www.solakon.de/blog/post", "https://www.solakon.de/blog/")).toBe(true);
    expect(urlBelongsToProperty("https://www.solakon.de/blogger", "https://www.solakon.de/blog/")).toBe(false);
    expect(urlBelongsToProperty("not a url", "https://www.solakon.de/")).toBe(false);
  });
});

describe("normalizeInspectUrl", () => {
  it("accepts http(s) and strips fragments", () => {
    expect(normalizeInspectUrl(" https://solakon.de/a?b=1#top ")).toBe("https://solakon.de/a?b=1");
  });
  it("rejects invalid input with InspectionError(invalid_url)", () => {
    for (const bad of ["solakon.de/a", "ftp://solakon.de/", "javascript:alert(1)"]) {
      try {
        normalizeInspectUrl(bad);
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InspectionError);
        expect((err as InspectionError).code).toBe("invalid_url");
      }
    }
  });
});

describe("utcDayStart", () => {
  it("returns UTC midnight", () => {
    expect(utcDayStart(new Date("2026-09-25T23:30:00+02:00")).toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });
});
