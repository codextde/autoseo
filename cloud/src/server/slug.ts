/** Instance addresses: `<slug>.autoseo.codext.de`. Pure (no DB) so it can be unit tested. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export const RESERVED_SLUGS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "smtp",
  "demo",
  "docs",
  "status",
  "cloud",
  "dashboard",
  "billing",
  "help",
  "support",
  "blog",
  "cdn",
  "static",
  "assets",
  "auth",
  "login",
  "signup",
  "autoseo",
  "coolify",
  "test",
  "dev",
  "staging",
  "root",
  "ns1",
  "ns2",
]);

export function normalizeSlug(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; slug: string; error: string };

/** Format + reserved-name check. Uniqueness is checked against the database separately. */
export function validateSlug(raw: string): SlugCheck {
  const slug = normalizeSlug(raw);
  if (slug.length < 3) return { ok: false, slug, error: "Use at least 3 characters." };
  if (slug.length > 30) return { ok: false, slug, error: "Use at most 30 characters." };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      slug,
      error: "Use lowercase letters, numbers and hyphens only (no hyphen at the start or end).",
    };
  }
  if (slug.includes("--")) return { ok: false, slug, error: "Consecutive hyphens are not allowed." };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, slug, error: "This address is reserved." };
  return { ok: true, slug };
}

/** Suggests a slug from a workspace / company name ("Acme GmbH" → "acme-gmbh"). */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}
