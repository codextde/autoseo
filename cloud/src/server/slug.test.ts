import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, suggestSlug, validateSlug } from "./slug";

describe("validateSlug", () => {
  it("accepts lowercase letters, digits and inner hyphens (3–30 chars)", () => {
    for (const slug of ["acme", "abc", "a1b", "acme-seo", "my-agency-2026", "a".repeat(30)]) {
      expect(validateSlug(slug)).toEqual({ ok: true, slug });
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(validateSlug("  Acme-SEO ")).toEqual({ ok: true, slug: "acme-seo" });
  });

  it("rejects too short and too long values", () => {
    expect(validateSlug("ab").ok).toBe(false);
    expect(validateSlug("").ok).toBe(false);
    expect(validateSlug("a".repeat(31)).ok).toBe(false);
  });

  it("rejects leading/trailing/double hyphens and invalid characters", () => {
    for (const slug of ["-acme", "acme-", "ac--me", "ac_me", "acme.io", "ümlaut", "ac me", "acme/", "xn--80ak6aa92e"]) {
      expect(validateSlug(slug).ok, slug).toBe(false);
    }
  });

  it("rejects every reserved name", () => {
    expect(RESERVED_SLUGS.size).toBe(29);
    for (const slug of RESERVED_SLUGS) {
      expect(validateSlug(slug), slug).toEqual({ ok: false, slug, error: "This address is reserved." });
    }
    expect(validateSlug("WWW")).toEqual({ ok: false, slug: "www", error: "This address is reserved." });
  });
});

describe("suggestSlug", () => {
  it("derives a valid slug from a company name", () => {
    expect(suggestSlug("Acme GmbH & Co. KG")).toBe("acme-gmbh-co-kg");
    expect(suggestSlug("Café Müller")).toBe("cafe-muller");
    expect(validateSlug(suggestSlug("  The Very Long Agency Name That Keeps Going  ")).ok).toBe(true);
  });
});
