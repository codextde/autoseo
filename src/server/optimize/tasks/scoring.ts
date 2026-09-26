/**
 * Task priority & fingerprint logic (pure, isomorphic — used by the generator, the UI and tests).
 *
 * priority = 10 × (0.65 × impact + 0.35 × (11 − effort))  → 10 … 100
 * High impact dominates; among equal impact, cheaper tasks rank first ("quick wins").
 */

export function clampScore(n: number, min = 1, max = 10): number {
  if (!Number.isFinite(n)) return Math.round((min + max) / 2);
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function priorityScore(impact: number, effort: number): number {
  const i = clampScore(impact);
  const e = clampScore(effort);
  return Math.round(10 * (0.65 * i + 0.35 * (11 - e)) * 10) / 10;
}

export type PriorityBand = { key: "p1" | "p2" | "p3" | "p4"; label: string; short: string };

export function priorityBand(priority: number): PriorityBand {
  if (priority >= 75) return { key: "p1", label: "Urgent", short: "P1" };
  if (priority >= 60) return { key: "p2", label: "High", short: "P2" };
  if (priority >= 45) return { key: "p3", label: "Medium", short: "P3" };
  return { key: "p4", label: "Low", short: "P4" };
}

export function impactBand(impact: number): "high" | "medium" | "low" {
  if (impact >= 7) return "high";
  if (impact >= 4) return "medium";
  return "low";
}

/** Canonical form of a fingerprint subject: lowercase, collapsed whitespace, no trailing slashes/protocol. */
export function normalizeSubject(part: string | number | null | undefined): string {
  return String(part ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for a (signal, subject…) pair; order of `parts` matters, case/whitespace don't. */
export function fingerprintKey(signal: string, parts: Array<string | number | null | undefined>): string {
  return [signal, ...parts.map(normalizeSubject)].join("|");
}

/** Small, fast, dependency-free 64-bit FNV-1a hash rendered as hex (fingerprints, change detection). */
export function hash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function taskFingerprint(signal: string, parts: Array<string | number | null | undefined>): string {
  return `${signal}:${hash64(fingerprintKey(signal, parts))}`;
}

/** Order-independent hash of arbitrary JSON (used to detect evidence changes). */
export function stableHash(value: unknown): string {
  return hash64(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Sort comparator for task lists: priority desc, then impact desc, then newest. */
export function compareTasks(
  a: { priority: number; impact: number; lastDetectedAt?: string | Date | null },
  b: { priority: number; impact: number; lastDetectedAt?: string | Date | null },
): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.impact !== a.impact) return b.impact - a.impact;
  const ta = a.lastDetectedAt ? new Date(a.lastDetectedAt).getTime() : 0;
  const tb = b.lastDetectedAt ? new Date(b.lastDetectedAt).getTime() : 0;
  return tb - ta;
}
