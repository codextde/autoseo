/** Saved-keyword tag normalization + 8-colour palette (port of open-seo `shared/{saved-keyword-tags,tag-colors}.ts`). Pure. */

export const TAG_COLOR_KEYS = ["slate", "rose", "amber", "lime", "emerald", "sky", "violet", "fuchsia"] as const;
export type TagColorKey = (typeof TAG_COLOR_KEYS)[number];

/** Hex swatches for the palette (Tailwind 500 shades). */
export const TAG_COLOR_HEX: Record<TagColorKey, string> = {
  slate: "#64748b",
  rose: "#f43f5e",
  amber: "#f59e0b",
  lime: "#84cc16",
  emerald: "#10b981",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  fuchsia: "#d946ef",
};

export const MAX_TAG_LENGTH = 64;
export const MAX_TAGS_PER_OPERATION = 20;

export function isTagColorKey(v: unknown): v is TagColorKey {
  return typeof v === "string" && (TAG_COLOR_KEYS as readonly string[]).includes(v);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** null colour → deterministic colour from the id. */
export function resolveTagColor(tag: { id: string; color?: string | null }): TagColorKey {
  if (isTagColorKey(tag.color)) return tag.color;
  return TAG_COLOR_KEYS[hashString(tag.id) % TAG_COLOR_KEYS.length]!;
}

export type NormalizedTag = { name: string; normalizedName: string };

export function normalizeTag(value: string): NormalizedTag | null {
  const name = value.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
  if (!name) return null;
  return { name, normalizedName: name.toLocaleLowerCase() };
}

export function normalizeTags(values: readonly string[] | undefined): NormalizedTag[] {
  const map = new Map<string, NormalizedTag>();
  for (const v of values ?? []) {
    const t = normalizeTag(v);
    if (!t || map.has(t.normalizedName)) continue;
    map.set(t.normalizedName, t);
  }
  return [...map.values()];
}

/** Tag input parsing: split on newline or comma. */
export function parseTagInput(value: string): string[] {
  return normalizeTags(value.split(/[\n,]+/)).map((t) => t.name);
}
