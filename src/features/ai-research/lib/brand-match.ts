/**
 * Brand matching used by Prompt Explorer scoring and answer highlighting (isomorphic).
 * Mirrors open-seo: case-insensitive, word boundaries when the brand starts/ends with a word
 * character, otherwise look-around guards on the same boundary (handles "C++", "AT&T").
 */

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function brandRegex(brand: string, flags = "i"): RegExp | null {
  const b = brand.trim();
  if (!b) return null;
  const startsWord = /^\w/.test(b);
  const endsWord = /\w$/.test(b);
  const pre = startsWord ? "\\b" : "(?<![\\w])";
  const post = endsWord ? "\\b" : "(?![\\w])";
  return new RegExp(`${pre}${escapeRegex(b)}${post}`, flags);
}

export function textMentionsBrand(text: string, brand: string | null | undefined): boolean | null {
  if (!brand?.trim()) return null;
  const re = brandRegex(brand);
  return re ? re.test(text) : null;
}

export function citationMatchesBrand(c: { url: string; title?: string | null }, brand: string | null | undefined): boolean {
  if (!brand?.trim()) return false;
  return `${c.url} ${c.title ?? ""}`.toLowerCase().includes(brand.trim().toLowerCase());
}

/** Splits text into segments for highlighting (`match` = true for brand occurrences). */
export function splitByBrand(text: string, brand: string | null | undefined): { text: string; match: boolean }[] {
  if (!brand?.trim()) return [{ text, match: false }];
  const re = brandRegex(brand, "gi");
  if (!re) return [{ text, match: false }];
  const out: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), match: false });
    out.push({ text: m[0], match: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}
